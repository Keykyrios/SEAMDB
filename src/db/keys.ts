import { err } from "./errors";

export interface KeyProvider {
  readonly label: "dev" | "production";
  dek(): Uint8Array;
}

export class DevKeyProvider implements KeyProvider {
  readonly label = "dev" as const;
  constructor(private readonly secret: Uint8Array) {
    if (secret.length !== 32) err("E_KEY", "AES-256 DEK must be 32 bytes.");
  }
  dek(): Uint8Array {
    return this.secret.slice();
  }
}

export class ProductionKeyProvider implements KeyProvider {
  readonly label = "production" as const;
  constructor(private readonly secret: Uint8Array) {
    if (secret.length !== 32) err("E_KEY", "AES-256 DEK must be 32 bytes.");
    if (secret.every((b) => b === 0)) err("E_KEY", "All-zero production DEK is refused.");
  }
  dek(): Uint8Array {
    return this.secret.slice();
  }
}

export function assertKeyForMode(provider: KeyProvider | null, mode: "development" | "production"): void {
  if (mode === "production" && provider?.label === "dev") {
    err("E_KEY", "Production mode refuses the labelled dev-key provider.");
  }
}
