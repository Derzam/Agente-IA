import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
export interface CipherEnvelope {
  key_version: string;
  iv: string;
  ciphertext: string;
  tag: string;
}
export class ChallengeCipher {
  constructor(
    private active: string,
    private keys: Record<string, string>,
  ) {
    if (
      !keys[active] ||
      Object.values(keys).some((k) => !/^[a-f0-9]{64}$/i.test(k))
    )
      throw Error("Invalid challenge key configuration");
  }
  seal(binding: string, secret: string): CipherEnvelope {
    const iv = randomBytes(12),
      c = createCipheriv(
        "aes-256-gcm",
        Buffer.from(this.keys[this.active]!, "hex"),
        iv,
      );
    c.setAAD(Buffer.from(binding));
    const encrypted = Buffer.concat([c.update(secret, "utf8"), c.final()]);
    return {
      key_version: this.active,
      iv: iv.toString("base64url"),
      ciphertext: encrypted.toString("base64url"),
      tag: c.getAuthTag().toString("base64url"),
    };
  }
  open(binding: string, v: CipherEnvelope) {
    try {
      const key = this.keys[v.key_version];
      if (!key) throw Error();
      const iv = Buffer.from(v.iv, "base64url"),
        tag = Buffer.from(v.tag, "base64url");
      if (iv.length !== 12 || tag.length !== 16 || v.ciphertext.length > 1024)
        throw Error();
      const c = createDecipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
      c.setAAD(Buffer.from(binding));
      c.setAuthTag(tag);
      return Buffer.concat([
        c.update(Buffer.from(v.ciphertext, "base64url")),
        c.final(),
      ]).toString("utf8");
    } catch {
      throw Error("CHALLENGE_TRANSPORT_INVALID");
    }
  }
}
export const challengeBinding = (
  tenant: string,
  conversation: string,
  customer: string,
  order: string,
  version: number,
  id: string,
) => JSON.stringify([tenant, conversation, customer, order, version, id]);
