# Crypto profile v0

- Hash: SHA-384 via WebCrypto (evidence). Page CRC is CRC-32 for storage integrity, not a secret commitment.
- AEAD: AES-256-GCM, 12-byte nonce uniqueness per key as specified in page-format.md.
- Signatures for capsules: Ed25519 as in the evidence plane.
- ML-KEM: **not** used as a page cipher or signature. Hybrid X25519+ML-KEM-768 remains a labelled **transport posture** in the evidence UI. A from-standard ML-KEM implementation is a separate research crate and must not be the only production boundary.
- Key hierarchy: master (KMS or labelled dev) → HKDF-SHA-384 → page DEK. Production mode refuses the embedded all-zero / well-known dev key.
- WAL may be encrypted with a distinct HKDF info string `SEAMDB/WAL/V1`.
