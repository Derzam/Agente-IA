import {
  createHmac,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
export class CursorCodec {
  private keys: Buffer[];
  constructor(current: string, previous?: string) {
    if (
      !/^[a-f0-9]{64}$/i.test(current) ||
      (previous && !/^[a-f0-9]{64}$/i.test(previous))
    )
      throw Error("Invalid cursor key");
    this.keys = [current, ...(previous ? [previous] : [])].map((v) =>
      Buffer.from(v, "hex"),
    );
  }
  sign(data: string) {
    const key = this.keys[0]!;
    return `${data}.${createHmac("sha256", key).update(data).digest("base64url")}`;
  }
  verify(cursor: string) {
    const [data, sig, ...extra] = cursor.split(".");
    if (!data || !sig || extra.length || cursor.length > 4096)
      throw Error("Invalid cursor");
    const got = Buffer.from(sig, "base64url");
    if (
      !this.keys.some((k) => {
        const want = createHmac("sha256", k).update(data).digest();
        return want.length === got.length && timingSafeEqual(want, got);
      })
    )
      throw Error("Invalid cursor");
    return data;
  }
}
let codec = new CursorCodec(randomBytes(32).toString("hex"));
export function configureCursorKey(key: string, previous?: string) {
  codec = new CursorCodec(key, previous);
}
export const cursorCodec = () => codec;
