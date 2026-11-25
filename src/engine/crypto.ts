import { buf, concat, equalBytes, hex, randomBytes, utf8 } from "./bytes";
import { ml_kem768 } from "@noble/post-quantum/ml-kem.js";
import { defaultEcdhGroup } from "./webcrypto-cap";

export async function aesGcmEncrypt(
  keyBytes: Uint8Array,
  plaintext: Uint8Array,
  aad: Uint8Array,
): Promise<{ nonce: string; ciphertext: string }> {
  const nonce = randomBytes(12);
  const key = await crypto.subtle.importKey("raw", buf(keyBytes), "AES-GCM", false, ["encrypt"]);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: buf(nonce), additionalData: buf(aad) }, key, buf(plaintext));
  return { nonce: hex(nonce), ciphertext: hex(new Uint8Array(ct)) };
}

export async function aesGcmDecrypt(
  keyBytes: Uint8Array,
  nonceHex: string,
  ciphertextHex: string,
  aad: Uint8Array,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", buf(keyBytes), "AES-GCM", false, ["decrypt"]);
  const nonce = hexTo(nonceHex);
  const ct = hexTo(ciphertextHex);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf(nonce), additionalData: buf(aad) }, key, buf(ct));
  return new Uint8Array(pt);
}

function hexTo(h: string): Uint8Array {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function aadBytes(parts: {
  tenant_id: string;
  object_id: string;
  object_type: string;
  schema_version: string;
  key_epoch: string;
}): Uint8Array {
  return utf8(
    [parts.tenant_id, parts.object_id, parts.object_type, parts.schema_version, parts.key_epoch].join("|"),
  );
}

// ── Hybrid transport: ML-KEM-768 + a classical ephemeral agreement ─────────────
//
// Wire shape (mirrors the TLS 1.3 X25519MLKEM768 hybrid group):
//   initiator → responder: { ek_i (1184 B), x_pub_i, group }
//   responder → initiator: { ek_r, x_pub_r, ct (1088 B encapsulated to ek_i), group }
// Session secret = HKDF-SHA-384( ikm = ecdh_shared || mlkem_shared,
//   info = "hybrid-<group>-mlkem768/<ek_i hex>/<ek_r hex>" ) → 32 bytes.
//
// Both halves are real: ML-KEM-768 comes from @noble/post-quantum
// (referenced implementation of FIPS 203), the classical agreement and HKDF
// from WebCrypto. The classical group is X25519 where the runtime ships it
// (most do) and ECDH P-256 otherwise — either way `hello.group` names it on
// the wire and the negotiation record names it in the UI, so nobody has to
// guess which curve produced a secret. Neither side can silently downgrade:
// the KEM shared secret is a mandatory HKDF input, so a classical-only peer
// derives a different secret.
//
// This authenticates KEY ESTABLISHMENT only. Witness-checkpoint signatures
// use the runtime's classical signature algorithm (Ed25519 or ECDSA P-384,
// each checkpoint names which); PQ signatures are out of scope here.

export type TransportGroup = "x25519" | "ecdh-p256";

export interface TransportNegotiation {
  profile: "hybrid-x25519-mlkem768" | "hybrid-p256-mlkem768" | "tls13-x25519" | "tls13-p256";
  groups: string[];
  pq_labelled: boolean;
  /** sha384:<hex> digest binding the record to the initiator's encapsulation key. */
  peer_ek?: string;
  note: string;
}

export interface TransportHello {
  /** ML-KEM-768 encapsulation key to publish on the wire. */
  ek: Uint8Array;
  /** Classical ephemeral public (32 B X25519 or 65 B uncompressed P-256 point). */
  x_pub: Uint8Array;
  /** Which classical agreement produced `x_pub` — stated, never assumed. */
  group: TransportGroup;
}

export interface TransportParty {
  hello: TransportHello;
  /** Privatehalf: ML-KEM decapsulation key + classical agreement private key. */
  kem_dk: Uint8Array;
  x_priv: CryptoKey;
}

export interface TransportReply {
  ek: Uint8Array;
  x_pub: Uint8Array;
  /** ML-KEM ciphertext encapsulated to the initiator's ek. */
  ct: Uint8Array;
  /** Responder's classical group; must equal the initiator's. */
  group: TransportGroup;
}

const GROUP_LABEL: Record<TransportGroup, string> = { x25519: "X25519", "ecdh-p256": "ECDH-P256" };
const GROUP_PUB_LEN: Record<TransportGroup, number> = { x25519: 32, "ecdh-p256": 65 };

async function groupKeyPair(g: TransportGroup): Promise<CryptoKeyPair> {
  return g === "x25519"
    ? ((await crypto.subtle.generateKey({ name: "X25519" }, false, ["deriveBits"])) as CryptoKeyPair)
    : await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
}

async function importGroupPublic(g: TransportGroup, raw: Uint8Array): Promise<CryptoKey> {
  return g === "x25519"
    ? crypto.subtle.importKey("raw", buf(raw), "X25519", false, [])
    : crypto.subtle.importKey("raw", buf(raw), { name: "ECDH", namedCurve: "P-256" }, false, []);
}

async function groupAgree(g: TransportGroup, peerPublic: CryptoKey, ownPrivate: CryptoKey): Promise<ArrayBuffer> {
  return g === "x25519"
    ? crypto.subtle.deriveBits({ name: "X25519", public: peerPublic }, ownPrivate, 256)
    : crypto.subtle.deriveBits({ name: "ECDH", public: peerPublic }, ownPrivate, 256);
}

/**
 * Create one side's hello: fresh ML-KEM-768 keypair + fresh classical
 * ephemeral in the runtime's strongest available group (X25519 preferred,
 * ECDH P-256 when the runtime has no X25519).
 */
export async function transportParty(group?: TransportGroup): Promise<TransportParty> {
  const g: TransportGroup = group ?? (await defaultEcdhGroup());
  const kem = ml_kem768.keygen();
  const pair = await groupKeyPair(g);
  const x_pub = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return { hello: { ek: kem.publicKey, x_pub, group: g }, kem_dk: kem.secretKey, x_priv: pair.privateKey };
}

function requireHybridHello(peer: TransportHello | TransportReply): void {
  if (!(peer.ek instanceof Uint8Array) || peer.ek.length !== 1184) {
    throw new Error("E_CRYPTO: ML-KEM-768 encapsulation key must be 1184 bytes");
  }
  const g = peer.group;
  if (g !== "x25519" && g !== "ecdh-p256") {
    throw new Error("E_CRYPTO: unknown classical agreement group");
  }
  if (!(peer.x_pub instanceof Uint8Array) || peer.x_pub.length !== GROUP_PUB_LEN[g]) {
    throw new Error(`E_CRYPTO: ${GROUP_LABEL[g]} public must be ${GROUP_PUB_LEN[g]} bytes`);
  }
}

/**
 * Responder step: encapsulate to the initiator's ML-KEM key, agree the
 * classical group named in the hello, derive the traffic secret. Returns the
 * reply to send back plus the secret.
 */
export async function transportReply(
  initiatorHello: TransportHello,
  responder: TransportParty,
): Promise<{ reply: TransportReply; secret: Uint8Array }> {
  requireHybridHello(initiatorHello);
  if (responder.hello.group !== initiatorHello.group) {
    throw new Error("E_CRYPTO: classical agreement group mismatch");
  }
  const g = initiatorHello.group;
  const enc = ml_kem768.encapsulate(initiatorHello.ek);
  const peerX = await importGroupPublic(g, initiatorHello.x_pub);
  const ecdh = await groupAgree(g, peerX, responder.x_priv);
  const secret = await transportSecret(ecdh, enc.sharedSecret, initiatorHello.ek, responder.hello.ek, g);
  return { reply: { ek: responder.hello.ek, x_pub: responder.hello.x_pub, ct: enc.cipherText, group: g }, secret };
}

/**
 * Initiator step: open the responder's KEM ciphertext with our decapsulation
 * key, agree the same classical point, and derive the SAME traffic secret.
 */
export async function transportFinish(
  responderReply: TransportReply,
  initiator: TransportParty,
): Promise<{ secret: Uint8Array }> {
  requireHybridHello(responderReply);
  if (responderReply.group !== initiator.hello.group) {
    throw new Error("E_CRYPTO: classical agreement group mismatch");
  }
  if (!(responderReply.ct instanceof Uint8Array) || responderReply.ct.length !== 1088) {
    throw new Error("E_CRYPTO: ML-KEM-768 ciphertext must be 1088 bytes");
  }
  const g = initiator.hello.group;
  const ss = ml_kem768.decapsulate(responderReply.ct, initiator.kem_dk);
  const peerX = await importGroupPublic(g, responderReply.x_pub);
  const ecdh = await groupAgree(g, peerX, initiator.x_priv);
  const secret = await transportSecret(ecdh, new Uint8Array(ss), initiator.hello.ek, responderReply.ek, g);
  return { secret };
}

/**
 * Ordered key schedule: HKDF-384 over (classical shared || ML-KEM shared)
 * with both published encapsulation keys folded into `info`, so the secret is
 * bound to this exact session's key material AND to the agreement group both
 * sides ran (a group mismatch derives divergent secrets, not a crash).
 */
async function transportSecret(
  ecdh_shared: ArrayBuffer,
  kem_shared: Uint8Array,
  ek_initiator: Uint8Array,
  ek_responder: Uint8Array,
  group: TransportGroup,
): Promise<Uint8Array> {
  // HKDF `info` is capped at 1024 bytes (RFC 8446-style field), so bind the
  // session to the encapsulation keys by their SHA-384 digests, not full keys.
  const [di, dr] = await Promise.all(
    [ek_initiator, ek_responder].map((ek) => crypto.subtle.digest("SHA-384", buf(ek))),
  );
  const classical = new Uint8Array(ecdh_shared);
  const ikm = new Uint8Array(classical.length + kem_shared.length);
  ikm.set(classical, 0);
  ikm.set(kem_shared, classical.length);
  const infoPrefix = group === "x25519" ? "hybrid-x25519-mlkem768/" : "hybrid-p256-mlkem768/";
  return new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: "HKDF",
        hash: "SHA-384",
        salt: buf(utf8("SEAMDB/TRANSPORT/V1")),
        info: buf(concat(utf8(infoPrefix), new Uint8Array(di), utf8("/"), new Uint8Array(dr))),
      },
      await crypto.subtle.importKey("raw", buf(ikm), "HKDF", false, ["deriveBits"]),
      256,
    ),
  );
}

/**
 * Negotiate and RUN the transport handshake. On the hybrid path a full
 * classical + ML-KEM-768 session is actually established between two freshly
 * generated parties, and the record binds to the encapsulation key used
 * (`peer_ek` digest). The classical path runs a real ephemeral agreement and
 * no KEM, and is marked NOT post-quantum. Both records name the exact groups
 * that ran — X25519 where WebCrypto has it, ECDH P-256 where it does not —
 * so the UI shows what happened, not what we wish happened.
 */
export async function negotiateTransport(peerSupportsHybrid: boolean): Promise<TransportNegotiation> {
  const group = await defaultEcdhGroup();
  const gLabel = GROUP_LABEL[group];
  if (peerSupportsHybrid) {
    const initiator = await transportParty(group);
    const responder = await transportParty(group);
    const reply = await transportReply(initiator.hello, responder);
    const finish = await transportFinish(reply.reply, initiator);
    if (!equalBytes(reply.secret, finish.secret)) {
      throw new Error("E_CRYPTO: hybrid handshake secret mismatch between parties");
    }
    const ekDigest = await crypto.subtle.digest("SHA-384", buf(initiator.hello.ek));
    return {
      profile: group === "x25519" ? "hybrid-x25519-mlkem768" : "hybrid-p256-mlkem768",
      groups: [gLabel, "ML-KEM-768"],
      pq_labelled: true,
      peer_ek: `sha384:${hex(new Uint8Array(ekDigest))}`,
      note:
        group === "x25519"
          ? "Hybrid key establishment ran end to end: ML-KEM-768 (@noble/post-quantum, FIPS 203) + X25519, HKDF-384 into one 32-byte traffic secret. Key establishment only; checkpoint signatures use the classical algorithm named in each checkpoint."
          : `Hybrid key establishment ran end to end: ML-KEM-768 (@noble/post-quantum, FIPS 203) + ${gLabel} (this runtime's WebCrypto has no X25519), HKDF-384 into one 32-byte traffic secret. Key establishment only; checkpoint signatures use the classical algorithm named in each checkpoint.`,
    };
  }
  // Classical path: run a real ephemeral agreement so the record states fact.
  const a = await transportParty(group);
  const b = await transportParty(group);
  const classical = await transportReply(a.hello, b);
  const done = await transportFinish(classical.reply, a);
  if (!equalBytes(classical.secret, done.secret)) {
    throw new Error("E_CRYPTO: classical handshake secret mismatch between parties");
  }
  return {
    profile: group === "x25519" ? "tls13-x25519" : "tls13-p256",
    groups: [gLabel],
    pq_labelled: false,
    note: `Classical ${gLabel} agreement ran end to end. NOT post-quantum; used when the peer does not advertise the hybrid group.`,
  };
}

export function deriveDek(tenantSecret: Uint8Array, objectId: string, epoch: string): Promise<ArrayBuffer> {
  return crypto.subtle
    .importKey("raw", buf(tenantSecret), "HKDF", false, ["deriveBits"])
    .then((key) =>
      crypto.subtle.deriveBits(
        {
          name: "HKDF",
          hash: "SHA-384",
          salt: buf(utf8(`SEAMDB/HKDF/${epoch}`)),
          info: buf(concat(utf8("SEAMDB/DEK/V1"), utf8(objectId))),
        },
        key,
        256,
      ),
    );
}
