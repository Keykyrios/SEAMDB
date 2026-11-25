import { canonicalizeBytes } from "./canonical";
import { domainHashTagged } from "./hash";
import { buildMerkle } from "./merkle";
import type { CanonicalRow, SourceView } from "./types";

export type ConnectorPhase =
  | "DISCOVER"
  | "VALIDATE_CREDENTIALS"
  | "PIN_SCHEMA"
  | "ACQUIRE_SNAPSHOT"
  | "ENUMERATE_PARTITIONS"
  | "HASH_CONTENT"
  | "VERIFY_COUNTS"
  | "EMIT_COMMIT"
  | "FAILED_CAPTURE";

export interface CaptureManifest {
  source_ref: string;
  connector_version: string;
  source_version_token: string;
  snapshot_mode: "repeatable-read" | "iceberg-snapshot" | "best-effort";
  isolation_level: string;
  partition_plan_digest: string;
  schema_digest: string;
  root_digest: string;
  row_count: number;
  byte_count: number;
  started_at: string;
  completed_at: string;
  watermark: string;
  warnings: string[];
  phases: ConnectorPhase[];
}

export async function captureSnapshot(args: {
  source: SourceView;
  rows: CanonicalRow[];
  token: string;
  commitmentSecret: Uint8Array;
  started_at: string;
}): Promise<{ manifest: CaptureManifest; tree: Awaited<ReturnType<typeof buildMerkle>> }> {
  const phases: ConnectorPhase[] = [
    "DISCOVER",
    "VALIDATE_CREDENTIALS",
    "PIN_SCHEMA",
    "ACQUIRE_SNAPSHOT",
    "ENUMERATE_PARTITIONS",
    "HASH_CONTENT",
    "VERIFY_COUNTS",
  ];
  const schema_digest = await domainHashTagged(
    "SEAMDB/SCHEMA/V1",
    canonicalizeBytes(args.source.schema),
  );
  const partition_plan_digest = await domainHashTagged(
    "SEAMDB/PARTITIONS/V1",
    canonicalizeBytes({ partitions: [...new Set(args.rows.map((r) => r.partition))].sort() }),
  );
  const tree = await buildMerkle(args.rows, schema_digest, "p0", { secret: args.commitmentSecret });
  if (tree.leaves.length !== args.rows.length) {
    throw new Error("FAILED_CAPTURE: row-count mismatch against merkle leaves");
  }
  phases.push("EMIT_COMMIT");
  const completed_at = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const byte_count = args.rows.reduce((n, r) => n + canonicalizeBytes(r.fields).length, 0);
  return {
    tree,
    manifest: {
      source_ref: args.source.source_ref,
      connector_version: args.source.connector_version,
      source_version_token: args.token,
      snapshot_mode: args.source.kind === "postgres" ? "repeatable-read" : "best-effort",
      isolation_level: args.source.kind === "postgres" ? "REPEATABLE READ" : "vendor-token",
      partition_plan_digest,
      schema_digest,
      root_digest: tree.root_commitment,
      row_count: args.rows.length,
      byte_count,
      started_at: args.started_at,
      completed_at,
      watermark: `lsn:${args.token}`,
      warnings: args.source.kind === "warehouse" ? ["Warehouse capture classified by vendor time-travel token."] : [],
      phases,
    },
  };
}
