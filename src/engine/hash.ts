import { buf, concat, hex, sha384Tag, utf8 } from "./bytes";

export async function sha384(data: Uint8Array): Promise<Uint8Array> {
  const d = await crypto.subtle.digest("SHA-384", buf(data));
  return new Uint8Array(d);
}

export async function sha384Hex(data: Uint8Array): Promise<string> {
  return hex(await sha384(data));
}

export async function domainHash(domain: string, ...parts: Uint8Array[]): Promise<Uint8Array> {
  return sha384(concat(utf8(domain), utf8("\0"), ...parts));
}

export async function domainHashTagged(domain: string, ...parts: Uint8Array[]): Promise<string> {
  return sha384Tag(await sha384Hex(concat(utf8(domain), utf8("\0"), ...parts)));
}

export async function hmacSha384(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    buf(key),
    { name: "HMAC", hash: "SHA-384" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, buf(data));
  return new Uint8Array(sig);
}

export async function hmacSha384Hex(key: Uint8Array, data: Uint8Array): Promise<string> {
  return hex(await hmacSha384(key, data));
}
