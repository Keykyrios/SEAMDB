import { concat, fromHex, hex, sha384Tag, utf8 } from "./bytes";
import { hmacSha384, sha384 } from "./hash";
import { canonicalizeBytes } from "./canonical";
import type { CanonicalRow, MerkleTree, ProofPath } from "./types";

const LEAF = utf8("SEAMDB/LEAF/V1");
const NODE = utf8("SEAMDB/NODE/V1");
const ROOT = utf8("SEAMDB/ROOT/V1");
const EMPTY = utf8("SEAMDB/EMPTY/V1");

function prefix(tag: number, domain: Uint8Array, payload: Uint8Array): Uint8Array {
  return concat(new Uint8Array([tag]), domain, payload);
}

export async function leafHash(
  canonicalLeaf: Uint8Array,
  keyed?: { secret: Uint8Array },
): Promise<Uint8Array> {
  const body = keyed ? await hmacSha384(keyed.secret, canonicalLeaf) : canonicalLeaf;
  return sha384(prefix(0x00, LEAF, body));
}

export async function nodeHash(left: Uint8Array, right: Uint8Array): Promise<Uint8Array> {
  return sha384(prefix(0x01, NODE, concat(left, right)));
}

export async function emptyTreeHash(): Promise<Uint8Array> {
  return sha384(prefix(0x02, EMPTY, utf8("")));
}

export async function rootCommitment(
  schemaDigest: Uint8Array,
  partitionId: string,
  treeRoot: Uint8Array,
): Promise<Uint8Array> {
  return sha384(concat(ROOT, schemaDigest, utf8("\0"), utf8(partitionId), utf8("\0"), treeRoot));
}

export function canonicalLeafBytes(row: CanonicalRow): Uint8Array {
  return canonicalizeBytes({
    row_ref: row.row_ref,
    partition: row.partition,
    fields: row.fields,
  });
}

export async function buildMerkle(
  rows: CanonicalRow[],
  schemaDigestHex: string,
  partitionId: string,
  keyed?: { secret: Uint8Array },
): Promise<MerkleTree> {
  const schemaDigest = fromHex(schemaDigestHex.replace(/^sha384:/, ""));
  if (rows.length === 0) {
    const empty = await emptyTreeHash();
    const commitment = await rootCommitment(schemaDigest, partitionId, empty);
    return {
      leaves: [],
      levels: [[hex(empty)]],
      tree_root: sha384Tag(hex(empty)),
      root_commitment: sha384Tag(hex(commitment)),
      schema_digest: sha384Tag(hex(schemaDigest)),
      partition_id: partitionId,
    };
  }

  const ordered = [...rows].sort((a, b) => (a.row_ref < b.row_ref ? -1 : a.row_ref > b.row_ref ? 1 : 0));
  const leafBytes: Uint8Array[] = [];
  for (const row of ordered) {
    leafBytes.push(await leafHash(canonicalLeafBytes(row), keyed));
  }

  const levels: Uint8Array[][] = [leafBytes];
  while (levels[levels.length - 1].length > 1) {
    const cur = levels[levels.length - 1];
    const next: Uint8Array[] = [];
    for (let i = 0; i < cur.length; i += 2) {
      if (i + 1 === cur.length) {
        next.push(cur[i]);
      } else {
        next.push(await nodeHash(cur[i], cur[i + 1]));
      }
    }
    levels.push(next);
  }

  const treeRoot = levels[levels.length - 1][0];
  const commitment = await rootCommitment(schemaDigest, partitionId, treeRoot);
  return {
    leaves: leafBytes.map((b) => sha384Tag(hex(b))),
    levels: levels.map((lvl) => lvl.map((b) => sha384Tag(hex(b)))),
    tree_root: sha384Tag(hex(treeRoot)),
    root_commitment: sha384Tag(hex(commitment)),
    schema_digest: sha384Tag(hex(schemaDigest)),
    partition_id: partitionId,
  };
}

export async function proveInclusion(tree: MerkleTree, leafIndex: number): Promise<ProofPath> {
  if (leafIndex < 0 || leafIndex >= tree.leaves.length) throw new Error("leaf index out of range");
  const siblings: ProofPath["siblings"] = [];
  let idx = leafIndex;
  for (let level = 0; level < tree.levels.length - 1; level++) {
    const nodes = tree.levels[level];
    const isRight = idx % 2 === 1;
    const pair = isRight ? idx - 1 : idx + 1;
    if (pair < nodes.length) {
      siblings.push({ side: isRight ? "L" : "R", hash: nodes[pair] });
    }
    idx = Math.floor(idx / 2);
  }
  return { leaf_index: leafIndex, siblings };
}

export async function verifyInclusion(
  tree: MerkleTree,
  leafIndex: number,
  proof: ProofPath,
): Promise<boolean> {
  if (tree.leaves.length === 0) return false;
  let acc = fromHex(tree.leaves[leafIndex]);
  for (const sib of proof.siblings) {
    const other = fromHex(sib.hash);
    acc = sib.side === "L" ? await nodeHash(other, acc) : await nodeHash(acc, other);
  }
  return sha384Tag(hex(acc)) === tree.tree_root;
}

export async function verifyRootCommitment(tree: MerkleTree): Promise<boolean> {
  const schema = fromHex(tree.schema_digest);
  const root = fromHex(tree.tree_root);
  const got = await rootCommitment(schema, tree.partition_id, root);
  return sha384Tag(hex(got)) === tree.root_commitment;
}
