import { canonicalize } from "./canonical";

export interface MdlFeatures {
  schema_delta: number;
  null_rate: number;
  cardinality_delta: number;
  join_ratio: number;
  graph_edit_cost: number;
  row_count_residual: number;
  lineage_branch_delta: number;
}

export interface MdlScore {
  score: number;
  l_model: number;
  l_data: number;
  l_ref_model: number;
  l_ref_window: number;
  features: MdlFeatures;
  alert: boolean;
  label: "MDL compression residual (not Kolmogorov complexity K(x))";
}

async function deflateLength(text: string): Promise<number> {
  if (typeof CompressionStream === "undefined") {
    return roughLz(text);
  }
  const cs = new CompressionStream("gzip");
  // Attach the consumer BEFORE the first await. A CompressionStream is a
  // TransformStream whose readable side has a zero high-water mark in
  // browsers: `await write()` cannot settle until the output is being read,
  // so awaiting write/close before attaching the reader deadlocks in
  // Chromium (Node's stream impl buffers instead, which is why this only
  // ever broke in the browser). Start the read first, then write.
  const bytes = new Response(cs.readable).arrayBuffer();
  const writer = cs.writable.getWriter();
  const finished = writer.write(new TextEncoder().encode(text)).then(() => writer.close());
  await finished;
  return (await bytes).byteLength;
}

function roughLz(text: string): number {
  const dict = new Map<string, number>();
  let w = "";
  let n = 0;
  for (const c of text) {
    const wc = w + c;
    if (dict.has(wc)) w = wc;
    else {
      dict.set(wc, dict.size);
      n += 2;
      w = c;
    }
  }
  if (w) n += 2;
  return n;
}

export async function mdlScore(
  current: Record<string, unknown>,
  reference: Record<string, unknown>,
  features: MdlFeatures,
  cryptoFailed: boolean,
  policyDenied: boolean,
): Promise<MdlScore> {
  const cur = canonicalize(current);
  const ref = canonicalize(reference);
  const l_data = await deflateLength(cur);
  const l_ref_window = await deflateLength(ref);
  const l_model = 7 * 16;
  const l_ref_model = 6 * 16;
  const residual =
    l_model +
    l_data -
    l_ref_model -
    l_ref_window +
    Math.round(
      0.4 * Math.abs(features.schema_delta) +
        0.3 * Math.abs(features.cardinality_delta) +
        0.5 * Math.abs(features.row_count_residual) +
        0.2 * features.graph_edit_cost +
        0.2 * features.lineage_branch_delta,
    );
  const threshold = 180;
  const high = 420;
  const invariantFail =
    features.row_count_residual > 50 || features.schema_delta > 2 || features.join_ratio < 0.5;
  const alert = residual > high || (residual > threshold && invariantFail);
  return {
    score: residual,
    l_model,
    l_data,
    l_ref_model,
    l_ref_window,
    features,
    alert: alert && !cryptoFailed && !policyDenied,
    label: "MDL compression residual (not Kolmogorov complexity K(x))",
  };
}
