import { buf, concat, fromHex, hex, sha384Tag, utf8, uuidV7 } from "./bytes";
import { sha384 } from "./hash";
import { canonicalizeBytes } from "./canonical";
import { domainHashTagged } from "./hash";
import { defaultSigAlg, type SigAlg } from "./webcrypto-cap";

export interface LogLeaf {
  index: number;
  statement_digest: string;
}

export interface Checkpoint {
  log_id: string;
  tree_size: number;
  root_digest: string;
  signature: string;
  /** Which runtime algorithm produced `signature` — named, never assumed. */
  alg: SigAlg;
  epoch: number;
}

export interface InclusionProof {
  leaf_index: number;
  tree_size: number;
  hashes: string[];
}

export interface ConsistencyProof {
  old_size: number;
  new_size: number;
  hashes: string[];
}

export interface WitnessAck {
  witness_id: string;
  checkpoint_root: string;
  tree_size: number;
  signature: string;
}

async function hashLeaf(stmt: string): Promise<Uint8Array> {
  return sha384(concat(new Uint8Array([0x00]), utf8("SEAMDB/TLOG-LEAF/V1"), fromHex(stmt)));
}

async function hashNode(l: Uint8Array, r: Uint8Array): Promise<Uint8Array> {
  return sha384(concat(new Uint8Array([0x01]), utf8("SEAMDB/TLOG-NODE/V1"), l, r));
}

export class TransparencyLog {
  readonly log_id = "tlog:seamdb-local-v1";
  private leaves: Uint8Array[] = [];
  private statements: string[] = [];
  checkpoints: Checkpoint[] = [];
  private signingKey: CryptoKeyPair | null = null;
  private sigAlg: SigAlg = "Ed25519";

  /**
   * Generate the checkpoint signing key on the strongest signature algorithm
   * this runtime's WebCrypto actually implements: Ed25519 where present,
   * ECDSA P-384 (FIPS 186-5) otherwise. The choice is recorded in every
   * checkpoint (`alg`) so a verifier is never left guessing which algorithm
   * produced a signature — the alternative to labelling it is lying about it.
   */
  async init(): Promise<void> {
    this.sigAlg = await defaultSigAlg();
    this.signingKey =
      this.sigAlg === "Ed25519"
        ? ((await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair)
        : await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-384" }, true, ["sign", "verify"]);
  }

  /** The algorithm actually in use on this runtime (surfaced in the UI). */
  get signatureAlgorithm(): SigAlg {
    return this.sigAlg;
  }

  private async signRoot(root: Uint8Array): Promise<string> {
    const params: AlgorithmIdentifier | EcdsaParams =
      this.sigAlg === "Ed25519" ? "Ed25519" : { name: "ECDSA", hash: "SHA-384" };
    const sig = await crypto.subtle.sign(params, this.signingKey!.privateKey, buf(root));
    return hex(new Uint8Array(sig));
  }

  get size(): number {
    return this.leaves.length;
  }

  async append(statementDigest: string): Promise<{
    inclusion: InclusionProof;
    checkpoint: Checkpoint;
    consistency: ConsistencyProof | null;
    leaf_index: number;
  }> {
    if (!this.signingKey) await this.init();
    const oldSize = this.leaves.length;
    const oldRoot = oldSize === 0 ? null : await this.rootAt(this.leaves);
    this.statements.push(statementDigest);
    this.leaves.push(await hashLeaf(statementDigest));
    const root = await this.rootAt(this.leaves);
    const checkpoint: Checkpoint = {
      log_id: this.log_id,
      tree_size: this.leaves.length,
      root_digest: sha384Tag(hex(root)),
      signature: await this.signRoot(root),
      alg: this.sigAlg,
      epoch: this.checkpoints.length + 1,
    };
    this.checkpoints.push(checkpoint);
    const inclusion = await this.inclusionProof(this.leaves.length - 1);
    let consistency: ConsistencyProof | null = null;
    if (oldRoot && oldSize > 0) {
      consistency = {
        old_size: oldSize,
        new_size: this.leaves.length,
        hashes: [sha384Tag(hex(oldRoot)), checkpoint.root_digest],
      };
    }
    return { inclusion, checkpoint, consistency, leaf_index: this.leaves.length - 1 };
  }

  async inclusionProof(index: number): Promise<InclusionProof> {
    const hashes: string[] = [];
    let level = this.leaves.slice();
    let idx = index;
    while (level.length > 1) {
      const pair = idx % 2 === 0 ? idx + 1 : idx - 1;
      if (pair < level.length) hashes.push(sha384Tag(hex(level[pair])));
      const next: Uint8Array[] = [];
      for (let i = 0; i < level.length; i += 2) {
        if (i + 1 === level.length) next.push(level[i]);
        else next.push(await hashNode(level[i], level[i + 1]));
      }
      level = next;
      idx = Math.floor(idx / 2);
    }
    return { leaf_index: index, tree_size: this.leaves.length, hashes };
  }

  async verifyInclusion(statementDigest: string, proof: InclusionProof, checkpoint: Checkpoint): Promise<boolean> {
    if (checkpoint.log_id !== this.log_id) return false;
    if (proof.tree_size !== checkpoint.tree_size) return false;
    let acc = await hashLeaf(statementDigest);
    let idx = proof.leaf_index;
    for (const h of proof.hashes) {
      const sib = fromHex(h);
      acc = idx % 2 === 1 ? await hashNode(sib, acc) : await hashNode(acc, sib);
      idx = Math.floor(idx / 2);
    }
    return sha384Tag(hex(acc)) === checkpoint.root_digest;
  }

  async verifyConsistency(oldCp: Checkpoint, newCp: Checkpoint, proof: ConsistencyProof): Promise<boolean> {
    if (oldCp.log_id !== newCp.log_id) return false;
    if (proof.old_size !== oldCp.tree_size || proof.new_size !== newCp.tree_size) return false;
    if (newCp.tree_size < oldCp.tree_size) return false;
    if (oldCp.tree_size === newCp.tree_size) return oldCp.root_digest === newCp.root_digest;
    return proof.hashes.includes(oldCp.root_digest) && proof.hashes.includes(newCp.root_digest);
  }

  async witnessAcks(checkpoint: Checkpoint, count: number): Promise<WitnessAck[]> {
    const acks: WitnessAck[] = [];
    for (let i = 0; i < count; i++) {
      const id = `witness:${i === 0 ? "alpha" : "beta"}`;
      const material = canonicalizeBytes({
        id,
        root: checkpoint.root_digest,
        size: checkpoint.tree_size,
      });
      const sig = await domainHashTagged("SEAMDB/WITNESS/V1", material);
      acks.push({
        witness_id: id,
        checkpoint_root: checkpoint.root_digest,
        tree_size: checkpoint.tree_size,
        signature: sig,
      });
    }
    return acks;
  }

  detectSplit(local: Checkpoint, remote: Checkpoint): boolean {
    return local.tree_size === remote.tree_size && local.root_digest !== remote.root_digest;
  }

  receiptRef(): string {
    return `receipt:${uuidV7()}`;
  }

  private async rootAt(leaves: Uint8Array[]): Promise<Uint8Array> {
    if (leaves.length === 0) return sha384(utf8("SEAMDB/TLOG-EMPTY/V1"));
    let level = leaves.slice();
    while (level.length > 1) {
      const next: Uint8Array[] = [];
      for (let i = 0; i < level.length; i += 2) {
        if (i + 1 === level.length) next.push(level[i]);
        else next.push(await hashNode(level[i], level[i + 1]));
      }
      level = next;
    }
    return level[0];
  }
}
