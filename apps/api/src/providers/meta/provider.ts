export interface MetaSend {
  recipient: string;
  text: string;
  callback: string;
  button?: string;
}
export type MetaResult =
  | { kind: "accepted"; id: string }
  | { kind: "retry" | "unknown" | "rejected"; code: string };
export interface MetaProvider {
  send(payload: MetaSend): Promise<MetaResult>;
}
export class CloudMetaProvider implements MetaProvider {
  constructor(
    private config: {
      token: string;
      phone: string;
      version: string;
      timeout: number;
    },
    private fetcher: typeof fetch = fetch,
  ) {
    if (!/^v\d+\.\d+$/.test(config.version) || !/^\d+$/.test(config.phone))
      throw Error("META_CONFIG_INVALID");
  }
  async send(p: MetaSend): Promise<MetaResult> {
    if (
      !/^\d{7,15}$/.test(p.recipient) ||
      !p.text ||
      p.text.length > 2000 ||
      (p.button && !/^confirm:[a-f0-9-]{36}:[A-Za-z0-9_-]{43}$/.test(p.button))
    )
      return { kind: "rejected", code: "META_PAYLOAD_INVALID" };
    try {
      const body = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: p.recipient,
        biz_opaque_callback_data: p.callback,
        ...(p.button
          ? {
              type: "interactive",
              interactive: {
                type: "button",
                body: { text: p.text.slice(0, 1024) },
                action: {
                  buttons: [
                    {
                      type: "reply",
                      reply: { id: p.button, title: "Confirmar pedido" },
                    },
                  ],
                },
              },
            }
          : { type: "text", text: { body: p.text, preview_url: false } }),
      };
      const response = await this.fetcher(
        `https://graph.facebook.com/${this.config.version}/${this.config.phone}/messages`,
        {
          method: "POST",
          redirect: "error",
          headers: {
            Authorization: `Bearer ${this.config.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.config.timeout),
        },
      );
      const reader = response.body?.getReader();
      if (!reader) return { kind: "unknown", code: "META_INVALID_RESPONSE" };
      let bytes = 0,
        chunks: Uint8Array[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > 16384) {
          await reader.cancel();
          return { kind: "unknown", code: "META_INVALID_RESPONSE" };
        }
        chunks.push(value);
      }
      const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (
        response.ok &&
        data.messaging_product === "whatsapp" &&
        data.messages?.length === 1 &&
        /^wamid\.[A-Za-z0-9+/=_-]{1,500}$/.test(data.messages[0].id)
      )
        return { kind: "accepted", id: data.messages[0].id };
      if (
        response.status === 429 &&
        Number.isSafeInteger(data.error?.code) &&
        !data.messages
      )
        return { kind: "retry", code: "META_RATE_LIMITED" };
      if (
        [400, 401, 403, 404].includes(response.status) &&
        Number.isSafeInteger(data.error?.code) &&
        !data.messages
      )
        return { kind: "rejected", code: "META_REJECTED" };
      return { kind: "unknown", code: "META_AMBIGUOUS" };
    } catch {
      return { kind: "unknown", code: "META_AMBIGUOUS" };
    }
  }
}
