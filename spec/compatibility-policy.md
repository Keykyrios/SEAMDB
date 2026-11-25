# Compatibility — seamql/0.1

Each database stores `language_version`. A process whose parser is older than the file refuses to open. A newer process may open 0.1 files but must not silently reinterpret 0.1 queries under a new grammar. New keywords require `seamql/0.2` and a catalog bump.

Unsupported syntax always errors. It never becomes a different valid statement.

Pretty-print canonicalizes to Gen Z keywords. Hashing statements for evidence uses the typed-plan fingerprint, not the raw string, so aliases do not fork history.
