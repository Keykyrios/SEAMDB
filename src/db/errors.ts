export type ErrorCode =
  | "E_SYNTAX"
  | "E_TRAILING"
  | "E_BAD_UTF8"
  | "E_BAD_ESCAPE"
  | "E_IDENT_UNICODE"
  | "E_TOKEN_LIMIT"
  | "E_TYPE_MISMATCH"
  | "E_OVERFLOW"
  | "E_DIV_ZERO"
  | "E_UNKNOWN_NAME"
  | "E_AMBIGUOUS"
  | "E_NEEDED"
  | "E_UNIQUE"
  | "E_FK"
  | "E_DENIED"
  | "E_CONFLICT"
  | "E_TX_STATE"
  | "E_FEATURE_NOT_SUPPORTED"
  | "E_CHECKSUM"
  | "E_WAL_CORRUPT"
  | "E_COMMIT_AMBIGUOUS"
  | "E_LIMIT"
  | "E_CORRUPT"
  | "E_LOCK"
  | "E_KEY"
  | "E_POLICY_FAIL";

export class SeamError extends Error {
  readonly code: ErrorCode;
  readonly line: number;
  readonly column: number;
  readonly byteOffset: number;
  readonly hint: string;

  constructor(code: ErrorCode, message: string, opts?: { line?: number; column?: number; byteOffset?: number; hint?: string }) {
    super(message);
    this.name = "SeamError";
    this.code = code;
    this.line = opts?.line ?? 1;
    this.column = opts?.column ?? 1;
    this.byteOffset = opts?.byteOffset ?? 0;
    this.hint = opts?.hint ?? "";
  }

  format(): string {
    const loc = `at line ${this.line}, column ${this.column}`;
    return `${this.code} ${loc}\n${this.message}${this.hint ? `\n${this.hint}` : ""}`;
  }
}

export function err(code: ErrorCode, message: string, opts?: ConstructorParameters<typeof SeamError>[2]): never {
  throw new SeamError(code, message, opts);
}
