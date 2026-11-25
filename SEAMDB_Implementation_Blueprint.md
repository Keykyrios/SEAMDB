**SEAMDB**

**THE PROOF-CARRYING  
DATABASE LAYER**

A post-quantum evidence mesh for regulated AI data supply chains

|     |
|-----|

A research-heavy product blueprint built around a commercially plausible wedge: prove what data was used, which policy authorized it, which upstream systems contributed it, and whether the result can be independently checked.

<table>
<colgroup>
<col style="width: 33%" />
<col style="width: 33%" />
<col style="width: 33%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>BUYER</strong></p>
<p><strong>CISO / CDO / AI Risk</strong></p>
<p>Regulated data teams</p></th>
<th><p><strong>WEDGE</strong></p>
<p><strong>Evidence capsules</strong></p>
<p>Across existing DBs</p></th>
<th><p><strong>MOAT HYPOTHESIS</strong></p>
<p><strong>Cross-view coherence</strong></p>
<p>Plus PQ transport</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

RESEARCH + BUILD BLUEPRINT \| 14 OCTOBER 2026

> **Markdown portability:** The architecture diagram is stored at `SEAMDB_Implementation_Blueprint_assets/media/image1.png`. Keep the asset folder beside this file, or use the companion ZIP bundle.

Prepared from five user-supplied mathematical manuscripts, plus current standards and database-security literature. Mathematical transfers are explicitly labeled as design hypotheses, not established cryptographic results.

## Contents

<details>
<summary>Show all sections</summary>

- [Executive brief](#executive-brief)
- [Who pays, and why this wedge first](#who-pays-and-why-this-wedge-first)
- [The user journey: from dataset to evidence capsule](#the-user-journey-from-dataset-to-evidence-capsule)
- [Architecture: overlay the estate, do not forklift it](#architecture-overlay-the-estate-do-not-forklift-it)
- [Cryptographic posture: PQ key establishment, not PQ signatures](#cryptographic-posture-pq-key-establishment-not-pq-signatures)
- [The Evidence Capsule: your core product primitive](#the-evidence-capsule-your-core-product-primitive)
- [Sheaf theory: make distributed contradictions measurable](#sheaf-theory-make-distributed-contradictions-measurable)
- [Algebraic geometry + bidirectional invariants](#algebraic-geometry-bidirectional-invariants)
- [Kolmogorov complexity, MDL, and ANOVA](#kolmogorov-complexity-mdl-and-anova)
- [Threat model and what the system can promise](#threat-model-and-what-the-system-can-promise)
- [Implementation blueprint: build the evidence plane](#implementation-blueprint-build-the-evidence-plane)
- [12-week MVP: one pipeline, one buyer, one proof dossier](#12-week-mvp-one-pipeline-one-buyer-one-proof-dossier)
- [Pricing, moat hypothesis, and go-to-market](#pricing-moat-hypothesis-and-go-to-market)
- [Risks, kill criteria, and product boundaries](#risks-kill-criteria-and-product-boundaries)
- [How the five supplied papers inform the design](#how-the-five-supplied-papers-inform-the-design)
- [Research base: recent work and standards](#research-base-recent-work-and-standards)
- [References and source registry](#references-and-source-registry)
- [Technical appendix: verifier semantics and invariants](#technical-appendix-verifier-semantics-and-invariants)
- [Technical appendix: build priorities and final call](#technical-appendix-build-priorities-and-final-call)
- [IMPLEMENTATION EDITION: FROM THESIS TO RUNNABLE SYSTEM](#implementation-edition-from-thesis-to-runnable-system)
- [System boundaries and trust domains](#system-boundaries-and-trust-domains)
- [Service topology, runtime contracts, and ports](#service-topology-runtime-contracts-and-ports)
- [Core data model and transactional invariants](#core-data-model-and-transactional-invariants)
- [Evidence Capsule v1: canonical wire object](#evidence-capsule-v1-canonical-wire-object)
- [SECP/0.1: proposed niche exchange protocol](#secp01-proposed-niche-exchange-protocol)
- [Cryptographic profile and post-quantum rollout](#cryptographic-profile-and-post-quantum-rollout)
- [Snapshot capture and connector semantics](#snapshot-capture-and-connector-semantics)
- [Policy gates, OPA, and one-use release grants](#policy-gates-opa-and-one-use-release-grants)
- [REST API and idempotency contract](#rest-api-and-idempotency-contract)
- [Merkle commitments, proof bundles, and verifier semantics](#merkle-commitments-proof-bundles-and-verifier-semantics)
- [Sheaf-inspired cross-view coherence engine](#sheaf-inspired-cross-view-coherence-engine)
- [Kolmogorov complexity, MDL, and ANOVA validation](#kolmogorov-complexity-mdl-and-anova-validation)
- [Algebraic geometry and symbolic constraints research lane](#algebraic-geometry-and-symbolic-constraints-research-lane)
- [Privacy, redaction, metadata leakage, and computer vision](#privacy-redaction-metadata-leakage-and-computer-vision)
- [Observability, SLOs, and incident runbooks](#observability-slos-and-incident-runbooks)
- [Test strategy: prove that the deny path works](#test-strategy-prove-that-the-deny-path-works)
- [Deployment blueprint: local development to production](#deployment-blueprint-local-development-to-production)
- [Repository layout and engineering ownership](#repository-layout-and-engineering-ownership)
- [12-week build backlog with acceptance criteria](#12-week-build-backlog-with-acceptance-criteria)
- [Go-live gates, RACI, and residual-risk register](#go-live-gates-raci-and-residual-risk-register)
- [Research-to-engineering traceability and references](#research-to-engineering-traceability-and-references)

</details>

**01 / THE THESIS**

# Executive brief

*A database evidence plane, not a new database engine.*

SEAMDB is a security and provenance layer that sits beside the customer's Postgres, Snowflake, Databricks, object store, and transformation jobs. It emits a compact, independently verifiable Evidence Capsule for any high-risk data export, training run, governed query, or cross-company data handoff.

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>THE ONE-SENTENCE IDEA</strong></p>
<p>Turn every important dataset release into a proof-carrying artifact: a snapshot commitment, lineage graph, policy decision, execution attestation, query/result binding, and tamper-evident transparency receipt.</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## The buyer does not pay for math. They pay to remove an expensive uncertainty.

| **Pain today**                                                                                                   | **SEAMDB promise**                                                                                                                | **Business outcome to test**                                                        |
|------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------|
| An audit asks which exact records and transformations produced a model or report. Teams reconstruct it manually. | One evidence capsule binds data snapshot, transform image, query, policy version, lineage parents, and receipt.                   | Reduce audit-evidence assembly from days to hours on a defined pipeline.            |
| Warehouse, feature store, CRM, and source-of-record silently disagree.                                           | Cross-view coherence checks surface conflicts before release, and retain a reproducible discrepancy witness.                      | Fewer model re-runs, reconciliation incidents, and disputed data handoffs.          |
| Cloud operators can administer storage; logs may be incomplete or mutable.                                       | Merkle commitments, append-only receipts, independent witnesses, and optional attested execution make tampering easier to detect. | Shorter incident investigation and higher partner confidence.                       |
| Long-lived sensitive data is exposed to harvest-now/decrypt-later risk on the network.                           | Hybrid TLS 1.3 key establishment using X25519 + ML-KEM-768 where supported.                                                       | Stronger migration posture for data with long confidentiality lifetimes \[R1, R2\]. |

## The sharp positioning

“Git-like evidence for data products, with a cryptographic receipt on every consequential export.” The product is neither a blockchain nor a replacement warehouse. It is an evidence control plane with adapters, cryptographic commitments, policy gates, and audit-grade receipts.

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>NON-NEGOTIABLE HONESTY</strong></p>
<p>The MVP will not claim to prove arbitrary SQL correctness. Query completeness and semantic correctness require a matching proof backend, a narrowly constrained query language, or independently attested deterministic execution.</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

**02 / CUSTOMER**

# Who pays, and why this wedge first

*The best first customer already has a costly cross-system trust problem.*

## Ideal customer profile

| **Profile**                                                              | **Buying trigger**                                                                                                       | **Economic buyer**                         | **Daily champion**                           |
|--------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------|--------------------------------------------|----------------------------------------------|
| Healthcare payer / provider network using claims or clinical data for AI | A model, analytics product, or vendor must be re-audited; datasets cross organizational boundaries.                      | Chief Data Officer, CISO, VP Data Platform | Data governance lead, ML platform lead       |
| Financial-services / insurance data platform                             | A regulator, internal model-risk team, or counterparty asks for evidence of source, policy, and transformation history.  | CISO, Chief Risk Officer, Head of Data     | Data engineering manager, model-risk analyst |
| Data provider or AI infrastructure vendor                                | Enterprise customers need proof that data was licensed, policy-filtered, versioned, and handled by an approved pipeline. | CEO/CTO, General Counsel, CDO              | Data operations and solutions engineering    |

## Start narrow: AI dataset release governance

The initial sell is not “secure every table in the enterprise.” It is “make one regulated AI dataset handoff auditable end-to-end.” Pick one data pipeline, two or three upstream systems, one high-value output, and a named risk owner. This makes the buyer, success condition, and procurement story concrete.

## What the customer gets in a paid pilot

- Connector to one warehouse and one upstream system; read-only first, no database replacement.

- Capture of schema, snapshot version, transformation digest, policy version, row-count and partition commitments.

- An evidence capsule for each designated export or training run, with a verifier command and human-readable audit report.

- A disagreement report for a few business-critical fields across at least two source views.

- Latency, ingestion overhead, evidence coverage, false-positive rate, and audit-workflow time measured against a baseline.

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>PILOT PRICING HYPOTHESIS, NOT MARKET DATA</strong></p>
<p>Charge $25,000-$40,000 for a 6-8 week design-partner pilot, creditable against an annual contract. Validate this with real procurement interviews before using it as a forecast.</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## Avoid these first buyers

Avoid tiny teams without regulated data, one-off consulting engagements without reusable connectors, and buyers whose only requirement is conventional database encryption. SEAMDB wins when the pain is proof, provenance, cross-party trust, and safe AI data reuse.

**03 / PRODUCT FLOW**

# The user journey: from dataset to evidence capsule

*A strict release gate creates a product customers can explain to auditors.*

<table>
<colgroup>
<col style="width: 8%" />
<col style="width: 91%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>01</strong></th>
<th><p><strong>Register source</strong></p>
<p>Bind a source identifier, tenant, table/object, schema, canonicalization version, connector version, and authoritative ownership metadata.</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

<table>
<colgroup>
<col style="width: 8%" />
<col style="width: 91%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>02</strong></th>
<th><p><strong>Commit snapshot</strong></p>
<p>Compute block-level commitments and a versioned root. Record counts, schema digest, partition boundaries, and snapshot timestamp; keep sensitive payloads in customer-controlled storage.</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

<table>
<colgroup>
<col style="width: 8%" />
<col style="width: 91%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>03</strong></th>
<th><p><strong>Capture lineage + policy</strong></p>
<p>Subscribe to OpenLineage-compatible job events and enrich them with SQL AST/query digest, code/container digest, access-policy result, data classification, and parent capsule IDs [R5].</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

<table>
<colgroup>
<col style="width: 8%" />
<col style="width: 91%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>04</strong></th>
<th><p><strong>Check cross-view consistency</strong></p>
<p>Compare authorized overlaps across source systems. Emit explicit discrepancy witnesses instead of silently selecting the newest or most convenient value.</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

<table>
<colgroup>
<col style="width: 8%" />
<col style="width: 91%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>05</strong></th>
<th><p><strong>Appraise execution</strong></p>
<p>For selected sensitive workloads, validate RATS-style evidence for the execution environment and enforce an allow-list of measured software and policy versions.</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

<table>
<colgroup>
<col style="width: 8%" />
<col style="width: 91%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>06</strong></th>
<th><p><strong>Issue receipt + gate</strong></p>
<p>Write a transparency statement, bind it to the committed capsule, collect independent witness receipts, and release the dataset only if the policy gate passes.</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

<table>
<colgroup>
<col style="width: 8%" />
<col style="width: 91%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>07</strong></th>
<th><p><strong>Verify independently</strong></p>
<p>An auditor receives the capsule plus proofs and uses a verifier to check hashes, lineage links, receipt inclusion/consistency, policy digest, and execution appraisal.</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>RELEASE RULE</strong></p>
<p>No evidence capsule, no high-risk export. Low-risk workloads can bypass the heavy path via explicit policy, but every bypass is itself logged as a governed decision.</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

**04 / SYSTEM ARCHITECTURE**

# Architecture: overlay the estate, do not forklift it

*The control plane is additive; the source systems remain the system of record.*

![SEAMDB system architecture](SEAMDB_Implementation_Blueprint_assets/media/image1.png)

## Component contracts

| **Component**                  | **Contract**                                                                            | **MVP boundary**                                                            |
|--------------------------------|-----------------------------------------------------------------------------------------|-----------------------------------------------------------------------------|
| Connector / capture agent      | Read-only source snapshot, schema, CDC metadata, source identity, and pipeline events.  | Postgres + S3/Iceberg first; warehouse connector next.                      |
| Evidence engine                | Canonical event encoding; keyed commitments; Merkle proofs; lineage DAG; policy digest. | Bounded schema types and partition-level commitments.                       |
| Coherence engine               | Check cross-system overlap contracts; emit mismatch/cycle witness.                      | Exact-match keys and explicit tolerances only.                              |
| Query / release gate           | Apply policy and query allow-list; bind query plan and result commitment.               | Predefined exports and deterministic jobs, not arbitrary SQL proof.         |
| Transparency + witness service | Append statements, return receipts, provide fork/consistency detection.                 | SCITT-oriented statement format plus independent witness deployment \[R3\]. |
| Verifier CLI / report UI       | Offline-verify proofs and export a human-readable evidence dossier.                     | CLI first; dashboard second.                                                |

**05 / SECURITY STACK**

# Cryptographic posture: PQ key establishment, not PQ signatures

*Use standardized primitives; make the composition auditable and algorithm-agile.*

| **Layer**                | **Choice**                                                                                                                                     | **Rationale / boundary**                                                                                                                                                                                                 |
|--------------------------|------------------------------------------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Transport                | TLS 1.3 hybrid X25519 + ML-KEM-768 (RFC 10024) where supported \[R2\].                                                                         | Combines conventional ECDHE and NIST ML-KEM. Treat client/server library support, certificate authentication, fallback policy, and telemetry as deployment gates.                                                        |
| PQC algorithm            | ML-KEM, formerly CRYSTALS-Kyber; use FIPS 203 parameter sets via maintained, reviewed libraries \[R1\].                                        | ML-KEM is a KEM for shared-secret establishment, not a signature algorithm. NIST has published an FIPS 203 planning note about an issue/errata; verify the current errata and validated module status before production. |
| At-rest payloads         | AES-256-GCM with unique nonce per key; envelope encryption and DEKs per tenant/object; KEKs in KMS/HSM \[R10\].                                | Nonce uniqueness is a hard security invariant. If nonce/key reuse occurs, GCM guarantees fail. Do not roll a home-grown AEAD.                                                                                            |
| Derivation + context     | HKDF-SHA-384; domain-separated labels for tenant, purpose, key epoch, and object class.                                                        | Key separation prevents accidental cross-protocol reuse; key rotation and revocation are first-class data-model fields.                                                                                                  |
| Commitments              | SHA-384 Merkle tree roots; HMAC-SHA-384 keyed commitments where public low-entropy hashes could enable dictionary attacks.                     | Hashes prove binding to a committed value, not truth of the original value or completeness of a query.                                                                                                                   |
| Authentication           | Enterprise IdP / WebAuthn or conventional mTLS identity; short-lived Ed25519 statement signatures may be used in the transparency integration. | Per request: no ML-DSA, no SLH-DSA, no quantum signature scheme. Classical signature authentication is not post-quantum and must be documented as a residual risk.                                                       |
| Niche protocol pair      | SCITT transparency statements + RATS remote-attestation appraisal \[R3\].                                                                      | SCITT provides a pattern for transparent signed statements; RATS structures attester/verifier/relying-party roles. Neither makes compromised inputs true.                                                                |
| Optional credential flow | OPAQUE aPAKE for a self-hosted password fallback only \[R4\].                                                                                  | It can keep the password hidden from the server in the protocol, but an OPAQUE 3DH suite is not itself a post-quantum guarantee. Prefer enterprise SSO/WebAuthn where available.                                         |

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>SECURITY CLAIM YOU CAN DEFEND</strong></p>
<p>“Post-quantum-hardened key establishment on supported connections, with tamper-evident data evidence and explicit limits.” Do not market this as end-to-end post-quantum digital-signature authenticity.</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

**06 / DATA MODEL**

# The Evidence Capsule: your core product primitive

*One bounded, versioned object ties content, computation, authority, and audit evidence together.*

## Capsule schema v0.1

| **Field**               | **Type / content**                                                    | **Why it exists**                                                                  |
|-------------------------|-----------------------------------------------------------------------|------------------------------------------------------------------------------------|
| capsule_id              | Random 128-bit or UUIDv7 identifier, namespace-scoped                 | Stable locator; random component reduces predictability.                           |
| tenant_id + source_id   | Opaque identifiers, no direct PII                                     | Separates security domains and avoids leaking business identifiers.                |
| snapshot_root           | Merkle root over canonical block commitments                          | Binds evidence to a defined snapshot; inclusion/completeness scope must be stated. |
| schema_digest           | Hash of canonical schema + semantic version                           | Stops a schema-only change from masquerading as the same dataset.                  |
| lineage_parents\[\]     | Parent capsule IDs and parent roots                                   | Captures directed provenance, not just the final output view.                      |
| transform_digest        | Git commit + image digest + dependency lockfile digest                | Binds pipeline code and runtime dependencies to the result.                        |
| query_digest            | Canonical AST digest + parameter commitment + supported proof profile | Names the operation without necessarily retaining sensitive SQL parameters.        |
| policy_digest           | Policy bundle digest + policy decision + evaluator version            | Makes the rule set and decision reproducible.                                      |
| attestation_ref         | RATS evidence reference and appraisal result, optional by tier        | Binds the execution environment to the chosen trust policy.                        |
| result_root + row_count | Output commitment, row count, partition metadata                      | Supports integrity and reconciliation; alone it does not prove query completeness. |
| receipt_bundle          | SCITT receipt, consistency proof, witness acknowledgements            | Lets an auditor detect later tampering or log split views.                         |
| crypto_epoch + expiry   | Key id/epoch, algorithm IDs, retention tier, expiry                   | Enables key rotation, cryptographic inventory, and lifecycle policy.               |

## Canonical commitment model

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p>capsule_digest = H(</p>
<p>"SEAMDB:capsule:v1" || canonical_CBOR(</p>
<p>tenant_id, source_id, snapshot_root, schema_digest,</p>
<p>lineage_parent_roots, transform_digest, query_digest,</p>
<p>policy_digest, attestation_ref, result_root, crypto_epoch</p>
<p>)</p>
<p>)</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

Use deterministic serialization (canonical CBOR or another explicitly specified canonical encoding), domain separation, length-delimited fields, schema versioning, and test vectors. If tenant identifiers, rare categories, or low-entropy values are hashed directly, attackers may guess inputs. Prefer keyed commitments or randomized salts where appropriate.

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>CRUCIAL PROOF BOUNDARY</strong></p>
<p>A Merkle inclusion proof proves that a leaf is in a particular committed tree. It does not prove that the source data was correct, that omitted rows do not exist, that a query is semantically correct, or that the policy itself is lawful.</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

**07 / MATHEMATICAL CORE**

# Sheaf theory: make distributed contradictions measurable

*A formal consistency layer over overlapping views, not a cryptographic primitive.*

Model each participating system as a local context: source-of-record, warehouse, feature store, partner extract, or AI staging area. Their overlaps are where business semantics should agree. The product turns those overlaps into explicit contracts, computes disagreement witnesses, and blocks releases when a high-severity incompatibility is unresolved.

## A modest formalization

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p>Let U = {U_i} be a cover of data contexts.</p>
<p>F(U_i) = admissible local data views under the declared contract.</p>
<p>For an overlap U_i intersect U_j, define restriction maps rho_ij.</p>
<p>Compatibility requires rho_ij(s_i) = rho_ji(s_j).</p>
<p>For numeric constraints: delta_ij = rho_ij(s_i) - rho_ji(s_j).</p>
<p>A zero discrepancy field means locally compatible; nonzero cycle residuals</p>
<p>can be represented as an obstruction witness in a chosen coefficient model.</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## What an operator actually sees

- “Policy ID P-48 agrees across warehouse and feature store, but the retention class differs.”

- “The same entity key maps to two currency codes on an overlap; aggregation would be unsafe.”

- “The row counts reconcile but the source-to-feature mapping has a cycle inconsistency.”

- “A legal hold exists upstream, but a derived table no longer carries the restriction facet.”

## Cohomology and obstruction classes

A research build can encode numeric or group-valued discrepancies in a cochain complex. With a defensible coefficient object and chosen cover, nontrivial first cohomology may represent an obstruction to globally compatible sections. Real systems include nulls, fuzzy identity, temporal intervals, and non-linear policy semantics; these need explicit semantics before cohomology has meaning. For the product MVP, a mismatch graph and cycle witness are the shippable baseline; sheaf cohomology is the formal extension.

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>HARD BOUNDARY</strong></p>
<p>A sheaf-consistency result says that declared local observations glue under the declared rules. It does not certify that any source system reported the truth, and it does not resist a cryptographic attacker by itself.</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

**08 / DEEPER RESEARCH**

# Algebraic geometry + bidirectional invariants

*Use hard mathematics where it yields decidable checks, not decorative vocabulary.*

## Algebraic-geometry module: constrained transform verification

Represent a small, typed transformation DSL with parameters x = (x1,...,xn), and encode its invariants as polynomial relations f1(x)=...=fm(x)=0 over an explicitly chosen field or ring. The ideal I = \<f1,...,fm\> describes admissible states. Gröbner-basis methods can test selected algebraic implications and detect some inconsistent constraint systems. This is a research module for restricted deterministic transforms, key mappings, and schema migrations, not a universal proof of SQL equivalence.

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p>I = &lt;f_1(x), ..., f_m(x)&gt; subset k[x_1, ..., x_n]</p>
<p>Goal: certify selected implication g(x)=0 on all admissible states.</p>
<p>Possible route: establish g belongs to the radical/ideal under explicit hypotheses,</p>
<p>or produce a counterexample state.</p>
<p>Non-polynomial, NULL-sensitive, time-dependent SQL needs a richer semantics.</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## The asymmetry trap: one-sided success is not a correctness proof

One supplied manuscript focuses on a ring-theoretic phenomenon: a one-sided inverse need not imply a two-sided inverse in its setting. The database translation is a design heuristic: a successful write acknowledgement, inclusion proof, or left-to-right reconciliation is not enough to infer global correctness. Require direction-specific checks: write then read-back; old-to-new migration and new-to-old reconciliation; producer receipt and independent witness consistency; output membership and query-completeness evidence.

## Projection is not provenance

Two datasets can have identical visible rows while carrying different legal rights, retention obligations, source provenance, consent state, or transformation histories. SEAMDB therefore defines equivalence over both payload and evidence capsule. The final projection is only one observable; a persistent provenance residue detects a meaningful difference that the rows alone erase.

## Filtration-inspired release gates

Treat evidence as a filtration: source identity -\> snapshot commitment -\> lineage closure -\> policy decision -\> execution appraisal -\> result binding -\> transparency receipt. A release is allowed only after all required gates for its tier pass. Failure at a gate creates a named obstruction with evidence, not a generic “verification failed.” Gate depth can vary by workload, but the audit records which gates were skipped and why.

**09 / MEASUREMENT SCIENCE**

# Kolmogorov complexity, MDL, and ANOVA

*Use complexity as a diagnostic; use statistics to test cost and benefit.*

## Kolmogorov-complexity-inspired drift detection

The true Kolmogorov complexity K(x\|M), the shortest program that describes trace x relative to model M, is not computable in general. SEAMDB must not put “exact K(x)” in a production alert. Instead, use a computable minimum-description-length proxy: encode a canonicalized sequence of lineage events under a versioned baseline model, then measure the excess code length or compression residual over rolling windows.

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p>MDL_proxy(x | M) = L(M) + L(x | M)</p>
<p>Drift score = excess_code_length(window_t, baseline) / window_size</p>
<p>Candidate alert = drift score + independent policy/invariant violation</p>
<p>Never treat a high score alone as proof of attack or misconduct.</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

The uploaded zero-entropy manuscript motivates a subtle warning: low aggregate entropy does not necessarily mean low structural complexity. For SEAMDB, the practical hypothesis is that simple-looking logs may still encode surprising temporal and cross-window constraints. Test it; do not assume it works.

## ANOVA plan: prove the system is worth running

Use a preregistered factorial benchmark to estimate the causal performance cost of crypto mode, proof granularity, and workload class. Randomize run order, block by machine/region, repeat enough times to estimate variance, inspect residual assumptions, and report effect sizes with confidence intervals. ANOVA is an engineering experiment, not a security proof.

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p>Y_ijkl = mu + A_crypto + B_proof + C_workload</p>
<p>+ AB + AC + BC + ABC + block_machine + epsilon</p>
<p>Responses: p50/p95/p99 latency, throughput, CPU, storage growth,</p>
<p>proof bytes, verifier time, capture lag, false-positive rate.</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

| **Factor**                | **Levels to compare**                                              | **Readout**                                                   |
|---------------------------|--------------------------------------------------------------------|---------------------------------------------------------------|
| A: transport              | Classical TLS vs hybrid X25519MLKEM768                             | Handshake cost, connection reuse, CPU; check library support. |
| B: evidence               | Hash chain only / Merkle capsule / capsule + attested execution    | Proof bytes, proof generation and verification time.          |
| C: workload               | OLTP writes / analytical query / bulk export / model-data snapshot | Tail latency, throughput, capture lag, storage overhead.      |
| Scale                     | 1M / 10M / 100M rows or equivalent data volume                     | Scaling shape; partition and index behavior.                  |
| Primary acceptance target | Predeclare customer-specific targets before test                   | Targets are hypotheses, not current measured results.         |

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>NO VANITY BENCHMARK</strong></p>
<p>Report both the happy path and the adversarial path: missing lineage parent, stale policy, nonce/epoch mismatch, inconsistent root, failed attestation, source disagreement, and witness split-view.</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

**10 / SECURITY ENGINEERING**

# Threat model and what the system can promise

*Threats first, primitives second.*

| **Adversary / failure**             | **What they try**                                                            | **Control and residual limit**                                                                                                                                           |
|-------------------------------------|------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Malicious or compromised DBA        | Rewrite rows, delete logs, or claim a different snapshot was used.           | Snapshot commitments, independent transparency receipts, witness quorum. If the initial capture lies, the system needs an independent source or signed source evidence.  |
| Compromised application service     | Export data outside policy or reuse stale authorization.                     | Short-lived scoped credentials, policy decision bound to capsule, least privilege, release gate, immutable audit of bypasses.                                            |
| Log equivocation / split view       | Show different histories to different auditors.                              | Append-only Merkle log, consistency proofs, out-of-band witness gossip/quorum, external receipt copies.                                                                  |
| Malicious data owner                | Supply inconsistent shares, schema lies, or invalid attributes.              | Input constraints, source-specific validation, cross-owner consistency checks; honest-majority assumptions must be explicit for any MPC mode \[R6\].                     |
| Harvest-now/decrypt-later actor     | Record traffic now and decrypt later.                                        | Hybrid post-quantum key establishment on supported links. This does not make old, already captured classical traffic safe retroactively.                                 |
| Key compromise / nonce reuse        | Forge ciphertext or expose objects under an affected key.                    | KMS/HSM custody, unique AEAD nonce management, strict key epoch boundaries, rotation/revocation, cryptographic inventory.                                                |
| TEE/runtime compromise              | Exploit side channels or a defect after boot-time attestation.               | RATS appraisal, measured versions, patch policy, minimized trusted code, reproducible builds, defense-in-depth. Attestation is not proof of absence of exploitable bugs. |
| Metadata inference                  | Learn tenant, rare schema values, or record existence through stable hashes. | Opaque IDs, tenant-keyed commitments, selective disclosure, rate limits, avoid public hashes of low-entropy fields.                                                      |
| Insider abuse / availability attack | Exfiltrate authorized rows or stop release.                                  | Dual control, break-glass logging, key separation, quotas, backpressure, recovery drills; cryptography cannot prevent all authorized misuse or denial of service.        |

## Security invariants to encode as tests

- Every capsule references a declared source snapshot and a complete parent list for the supported pipeline.

- No encryption key is reused across tenant/object domains; AES-GCM nonces are unique within a key domain.

- An absent or invalid witness receipt, stale policy bundle, failed appraisal, or unresolved high-severity consistency conflict blocks the relevant release.

- Proof verification is fail-closed, deterministic, versioned, and test-vector-backed.

- Key rotation, revocation, deletion, backup restore, and retention expiration are exercised before production.

**11 / TECHNICAL DESIGN**

# Implementation blueprint: build the evidence plane

*Start with the smallest trusted computing base and grow by query class.*

## Suggested services

| **Service**           | **Implementation idea**                                                                    | **Trust boundary**                                                            |
|-----------------------|--------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------|
| Capture agent         | Go or Rust sidecar/agent; read-only DB credentials; CDC connectors; canonical serializers. | Runs in customer VPC; no default write permission to source.                  |
| Control API           | Python/FastAPI or Go; OIDC; fine-grained policy decisions; OpenAPI schema.                 | Stateless; scoped, short-lived tokens; admin plane separated from data plane. |
| Evidence store        | Postgres metadata + object storage for capsules/proof bundles; append-only event batches.  | Sensitive metadata encrypted; separate from source payloads.                  |
| Merkle/receipt worker | Batch commitment construction; inclusion/consistency proofs; SCITT integration.            | Minimal code; deterministic serialization; independent witnesses.             |
| Policy engine         | OPA/Rego or equivalent versioned policy bundle; decision id bound to capsule.              | Policy authorship and deployment approvals separated from operator access.    |
| Query broker          | Predefined export profiles; workload identity; optional confidential VM/TEE.               | No arbitrary user-supplied native SQL in the initial proof-critical path.     |
| Verifier              | Standalone CLI/library; offline verification; JSON + PDF dossier.                          | Open specification and independent implementation are long-term trust goals.  |

## Minimal API surface

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p>POST /v1/sources/{id}/snapshots</p>
<p>POST /v1/jobs/{id}/events # OpenLineage-compatible ingestion</p>
<p>POST /v1/capsules # create or finalize capsule</p>
<p>POST /v1/capsules/{id}/verify # server-side verification</p>
<p>GET /v1/capsules/{id}/evidence # authorized capsule bundle</p>
<p>POST /v1/releases/{profile}/authorize # policy-gated release</p>
<p>GET /v1/transparency/{statement_id} # receipt + consistency proof</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## Suggested relational schema

sources(source_id, tenant_id, kind, owner, connector_version, status); snapshots(snapshot_id, source_id, schema_digest, root, row_count, observed_at, crypto_epoch); capsules(capsule_id, snapshot_id, transform_digest, query_digest, policy_digest, result_root, state); lineage_edges(child_capsule_id, parent_capsule_id, edge_kind); policy_decisions(decision_id, capsule_id, bundle_digest, outcome, evaluator_version); receipts(statement_id, capsule_id, log_id, receipt_blob, witness_set, created_at); discrepancies(discrepancy_id, overlap_id, severity, witness_digest, disposition).

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>DO NOT START WITH</strong></p>
<p>A custom storage engine, custom cipher, chain token, general encrypted SQL, or “prove any query” marketing. Those are large programs that dilute the buyer-facing wedge.</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

**12 / DELIVERY PLAN**

# 12-week MVP: one pipeline, one buyer, one proof dossier

*A disciplined schedule that produces customer evidence, not a research demo.*

| **Weeks** | **Workstream**                        | **Deliverable / exit criterion**                                                                                              |
|-----------|---------------------------------------|-------------------------------------------------------------------------------------------------------------------------------|
| 1-2       | Design partner + threat model         | Signed pilot scope; source schema; data-flow map; security assumptions; baseline audit workflow measured.                     |
| 3-4       | Connector + canonical snapshot        | Read-only connector; schema versioning; row/partition counts; deterministic serializer; replayable test fixture.              |
| 5-6       | Evidence capsule + Merkle receipts    | Capsule schema v0.1; Merkle proofs; hash-chain/append-only batch log; offline verifier; nonce/key-epoch tests.                |
| 7-8       | Policy + provenance + SCITT           | OpenLineage ingestion; policy digest; receipt integration; external witness copy; deny path demonstrated.                     |
| 9-10      | Cross-view consistency + PQ transport | 2-source overlap rules; discrepancy graph; hybrid TLS experiment on supported stack; no unsupported fallback presented as PQ. |
| 11        | RATS / protected execution option     | Attestation profile for one supported environment; appraisal fail-closed tests; document TEE residual assumptions.            |
| 12        | Pilot report + commercialization gate | Evidence dossier; p95/p99 and overhead report; table-top incident exercise; renewal proposal and next connector backlog.      |

## Definition of done

- A non-founder can run the verifier from a fresh environment and reproduce PASS/FAIL results from the capsule bundle.

- A missing parent root, modified output, stale policy digest, inconsistent witness proof, or revoked key fails verification visibly.

- At least one customer can map the dossier to a named audit or data-sharing workflow and pays for the pilot.

- Performance overhead is measured against an explicit baseline; no invented benchmark numbers in sales materials.

- The team has documented what is and is not proven by each proof profile.

## Engineering sequence after MVP

Next, add a second warehouse connector, temporal lineage, signed source manifests, redaction/selective disclosure, optional ZK proof backend for a restricted query profile, and formal verification of capsule parsing and policy-gate transitions. Keep all high-cost cryptographic proofs opt-in by data tier until benchmarked.

**13 / BUSINESS MODEL**

# Pricing, moat hypothesis, and go-to-market

*Sell audit-ready evidence and controlled data reuse, not the word “quantum”.*

## Packaging hypothesis

| **Package**             | **Target**                                                                                      | **Indicative pricing hypothesis** | **Boundary**                                                                       |
|-------------------------|-------------------------------------------------------------------------------------------------|-----------------------------------|------------------------------------------------------------------------------------|
| Pilot / Evidence Sprint | One pipeline, 2 sources, one AI dataset handoff                                                 | \$25k-\$40k one-time, 6-8 weeks   | Fixed scope, measured before/after, credited partly toward annual agreement.       |
| Team                    | 2-3 connectors, policy gates, capsule CLI, standard receipts                                    | \$60k-\$120k ARR                  | One business unit, capped evidence volume, business-hours support.                 |
| Enterprise / Isolated   | Multiple business units, private deployment, witness service, advanced retention/key management | \$180k-\$450k ARR                 | Annual platform + connector + support bands; quote based on volume and deployment. |
| Premium assurance       | Custom proof backend, protected execution, formal methods / audit support                       | Scoped services + uplift          | Never promise regulatory certification or arbitrary SQL proof by default.          |

These are willingness-to-pay hypotheses for discovery, not observed market prices. Validate with at least 15 buyer conversations and 3 paid pilots before anchoring a revenue forecast.

## Land and expand

- Land: single regulated AI dataset release or partner data exchange that already causes manual audit work.

- Expand: additional data stores and data products; cross-view discrepancy monitoring; standardized evidence dossiers.

- Platform value: customer-owned evidence bundles plus independent verifier reduce dependence on the vendor itself.

- Channel: data engineering / governance consultancies, cloud security partners, confidential-computing integrators, and audit-focused implementation firms.

## Competitive reality

The adjacent field is not empty. OpenLineage covers standardized lineage metadata \[R5\]; SCITT gives an architecture for transparency of signed statements \[R3\]; recent papers explore query verification and encrypted indexing \[R7, R8\]; confidential computing supplies attestation mechanisms. SEAMDB must win through the integrated workflow: portable proof capsules, cross-view coherence, policy-bound release gates, and evidence that spans existing tools. A trademark/patent/competitor diligence sprint is required before claiming uniqueness.

## Moat hypothesis

The defensible asset is not a novel hash function. It is the normalized evidence model, connectors, verifier interoperability, failure taxonomy, policy-to-data mappings, independent witness network, and accumulated deployment knowledge across real customer pipelines.

**14 / INVESTMENT DISCIPLINE**

# Risks, kill criteria, and product boundaries

*Treat these as hypotheses to invalidate, not assumptions to decorate.*

| **Risk**                              | **Early warning**                                                                            | **Mitigation / kill criterion**                                                                                                                               |
|---------------------------------------|----------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------|
| No differentiated buyer urgency       | Prospects like the diagram but will not pay for a scoped pilot.                              | Kill or reposition if 15-20 qualified interviews yield no 3 paid pilots or equivalent budgeted commitments.                                                   |
| Proof overhead too expensive          | Attested execution or proof creation destroys export throughput.                             | Offer tiered proof profiles. Kill full-path mode for workloads that cannot meet customer latency/throughput target.                                           |
| False confidence from hashes          | Customer assumes root means truth or completeness.                                           | Per-proof guarantee catalog; verifier warnings; training; contractually bound supported query classes.                                                        |
| Source adapters fragment              | Each warehouse has different snapshots, schema semantics, and CDC gaps.                      | Prioritize two sources; publish connector conformance tests; version every adapter.                                                                           |
| Sheaf layer is hard to operationalize | Too many false alarms because entity resolution/semantics are underspecified.                | Start with deterministic overlap contracts; use sheaf cohomology only where a coefficient model is defensible.                                                |
| PQC migration complexity              | Browser/driver/managed-service stack lacks hybrid handshake support or has fragile fallback. | Capability discovery; explicit telemetry; staged rollout; no unsupported “PQC” badge.                                                                         |
| Quantum-era signature gap             | Classical signatures remain long-term vulnerable.                                            | State that limitation; short-lived identities, independent witnesses, algorithm agility, evidence re-stamping when approved signing transitions are in scope. |
| Regulatory overclaim                  | Sales says “compliant” or “provably private” without evidence.                               | Market as evidence/control tooling, not legal compliance; buyer and counsel map controls to obligations.                                                      |
| TEE trust exceeds reality             | Attestation accepted as proof that runtime has no bug.                                       | Document firmware, vendor, side-channel, patch, and runtime risks; keep data minimization and policy boundaries outside the TEE.                              |

## Explicitly out of scope in version 1

- General-purpose encrypted SQL across arbitrary relational operators.

- A new cryptographic primitive, home-grown KEM, or new signature scheme.

- Public blockchain tokenomics or a consensus network as a product requirement.

- Automatic legal conclusions, data licensing judgments, or consent interpretation without a defined policy owner.

- Claims that local-global consistency implies the underlying data is truthful.

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>THE BEST KILL TEST</strong></p>
<p>If customers cannot name one recurring, expensive, auditable data handoff where evidence currently takes days or creates unacceptable risk, do not build the whole platform. Ship a narrow evidence-capsule tool first.</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

**15 / SOURCE-TO-DESIGN MAP**

# How the five supplied papers inform the design

*The manuscripts are inspirations for design invariants, not database-security evidence.*

| **User-supplied manuscript**                                                                                       | **Idea extracted**                                                                                                       | **Careful product translation**                                                                                                                                       |
|--------------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| U1. “A finite Smith-Toda complex V(4) at the prime 1009” (Sep 23, 2026; paper (2).pdf)                             | Layered construction, obstruction targets, filtration, and a proof that an obstruction vanishes before a critical stage. | Proof-gated release filtration: source -\> lineage -\> policy -\> execution -\> result -\> receipt. Every gate has an explicit obstruction and bounded failure state. |
| U2. “A zero-entropy system without a smooth positive-volume model” (Sep 25, 2026; paper (3).pdf)                   | Aggregate entropy can fail to capture structural constraints; switching and cross-window relations matter.               | Use MDL/compression residuals as drift diagnostics over event windows; do not treat entropy alone as complexity, or the score as an attack proof.                     |
| U3. “Abelian covers, Gale correspondences, and the Hodge conjecture for powers” (Oct 6, 2026; paper (4).pdf)       | Local/global correspondences, variation, compatibility, and algebraic structure across linked objects.                   | Model overlapping data views and provenance mappings, with a sheaf-style compatibility layer. This is a new analogy, not a theorem transferred from Hodge theory.     |
| U4. “A Counterexample to Kaplansky’s Direct-Finiteness Conjecture in Odd Characteristic” (Sep 26, 2026; paper.pdf) | One-sided inverse can fail to imply two-sided inverse in the manuscript's ring setting.                                  | Never accept one-directional integrity checks as global correctness; verify both sides, round-trips, and independent witnesses.                                       |
| U5. “A counterexample to the nearby Lagrangian conjecture” (Sep 23, 2026; paper (1).pdf)                           | A visible projection can omit a nontrivial underlying obstruction; stable invariants matter.                             | Rows that appear identical can carry different provenance, rights, policy history, or retention duties. Compare both payload and evidence capsule.                    |

## How to interpret this map

The mathematical results in the five supplied PDFs concern stable homotopy theory, ergodic dynamics, Hodge theory, group algebras, and symplectic topology. They do not establish the security of SEAMDB. This blueprint extracts methodological motifs and proposes fresh engineering mappings; each mapping must be independently tested, and the mathematics must be formalized before any theorem-level claims are made.

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>SOURCE-INTEGRITY NOTE</strong></p>
<p>I treated the uploads as user-supplied manuscripts and did not independently authenticate their publication or peer-review status. All statements attributed to them above describe the contents surfaced in those documents.</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

**16 / RESEARCH LOG**

# Research base: recent work and standards

*22 targeted web searches across PQC, verifiable databases, lineage, transparency, and measurement.*

## Research findings that directly affect the architecture

- \[R1\] NIST FIPS 203 standardizes ML-KEM for shared-secret establishment. It defines ML-KEM-512, ML-KEM-768, and ML-KEM-1024; the page also carries a planning note about an identified issue slated for correction. Check live errata and module validation before shipping.

- \[R2\] IETF RFC 10024 defines post-quantum/traditional hybrid key agreement for TLS 1.3, including X25519MLKEM768. Use supported, tested stacks and measure handshake overhead. Authentication and signature choices remain separate design decisions.

- \[R3\] RFC 9943 describes the SCITT architecture for transparent, auditable signed supply-chain statements. Reuse its statement/transparency model rather than inventing a ledger primitive.

- \[R4\] RFC 9807 documents OPAQUE, an augmented password-authenticated key exchange. Useful only as an optional password fallback; it should not be described as post-quantum by itself.

- \[R5\] OpenLineage is an extensible open standard for lineage metadata around datasets, jobs, and runs. Adopt it at the integration boundary instead of building an incompatible event model.

- \[R6\] Gu, Li, and Shi (Cybersecurity, 2026; published Oct 9) address verifiable and robust query processing for multi-owner secret-shared databases under malicious owners. This supports treating malicious-input behavior and per-query governance as first-class design cases, not assuming every data owner is honest.

- \[R7\] A 2026 Journal of Information Security and Applications paper proposes history-independent indexing for queryable encrypted databases, emphasizing leakage-aware indexing and deployment practicality. This is a reminder that encrypted querying leaks can be subtle and index design matters.

- \[R8\] PoneglyphDB (ACM Proceedings of the ACM on Management of Data, 2025) explores non-interactive zero-knowledge verification of SQL queries. Treat it as an advanced proof-backend direction, not a feature to reimplement casually.

- \[R9\] Robinson (Information Fusion, 2017) argues that sheaves can formalize multi-source consistency and identify information loss in sensor fusion. It offers a prior conceptual bridge for the proposed overlap-consistency engine, but not a ready-made enterprise database implementation.

- \[R10\] NIST SP 800-38D specifies GCM/GMAC and stresses key/IV construction requirements. AEAD nonce uniqueness and key management are implementation invariants, not optional tuning.

## Search coverage (22 targeted queries)

The search sweep covered: NIST ML-KEM/FIPS 203; hybrid TLS 1.3; SCITT status and architecture; verifiable database/query processing; queryable encryption and history-independent indexes; ZK SQL proofs; malicious-owner multi-party databases; sheaf theory for data integration; Kolmogorov/MDL anomaly detection; ANOVA for benchmarking; confidential computing and RATS; OpenLineage; OPAQUE; key management; AES-GCM nonce requirements; audit logging; and enterprise AI governance pain. Sources and URLs are listed on the next page for reproducibility.

**17 / BIBLIOGRAPHY**

# References and source registry

*Online sources checked 14 October 2026. User-supplied manuscripts are listed separately.*

\[R1\] NIST, FIPS 203: Module-Lattice-Based Key-Encapsulation Mechanism Standard (13 Aug 2024; current page includes a Nov 2025 planning note). [Open source](https://csrc.nist.gov/pubs/fips/203/final)

\[R2\] Kwiatkowski, Kampanakis, Westerbaan, Stebila. RFC 10024: Post-Quantum Traditional (PQ/T) Hybrid Key Agreement Mechanisms for TLS 1.3 (2026). [Open source](https://www.rfc-editor.org/rfc/rfc10024.html)

\[R3\] Birkholz et al. RFC 9943: An Architecture for Trustworthy and Transparent Digital Supply Chains (SCITT, 2026). [Open source](https://www.rfc-editor.org/rfc/rfc9943.html)

\[R4\] Bourdrez, Krawczyk, Lewi, Wood. RFC 9807: The OPAQUE Augmented Password-Authenticated Key Exchange (aPAKE) Protocol (July 2025). [Open source](https://www.rfc-editor.org/rfc/rfc9807.html)

\[R5\] OpenLineage project documentation, version 1.53.0, lineage model for datasets/jobs/runs. [Open source](https://openlineage.io/docs/1.53.0/)

\[R6\] Gu, L.; Li, J.; Shi, J. “Verifiable and robust query processing for multi-owner secret-shared databases under malicious owners.” Cybersecurity 9, article 231 (9 Oct 2026). [Open source](https://link.springer.com/article/10.1186/s42400-026-00674-4)

\[R7\] “Practical and secure history-independent indexing for queryable-encrypted databases.” Journal of Information Security and Applications 99 (June 2026), article 104439. [Open source](https://doi.org/10.1016/j.jisa.2026.104439)

\[R8\] Gu, B.; Fang, J.; Nawab, F. “PoneglyphDB: Efficient Non-interactive Zero-Knowledge Proofs for Arbitrary SQL-Query Verification.” Proceedings of the ACM on Management of Data 3(1), 2025. [Open source](https://doi.org/10.1145/3709713)

\[R9\] Robinson, M. “Sheaves are the canonical data structure for sensor integration.” Information Fusion 36 (2017), 208-224. [Open source](https://doi.org/10.1016/j.inffus.2016.12.002)

\[R10\] Dworkin, M. NIST SP 800-38D: Recommendation for Block Cipher Modes of Operation: GCM and GMAC (2007, current NIST page). [Open source](https://csrc.nist.gov/pubs/sp/800/38/d/final)

\[R11\] NIST NCCoE, Migration to Post-Quantum Cryptography: FAQs and migration project. [Open source](https://pages.nist.gov/nccoe-migration-post-quantum-cryptography/)

\[R12\] CISA, Use Logging on Business Systems; and Secure-by-Design audit logging guidance. [Open source](https://www.cisa.gov/audiences/small-and-medium-businesses/secure-your-business/use-logging-on-business-systems)

\[R13\] Feng et al. “Survey of research on confidential computing.” IET Communications (2024). [Open source](https://ietresearch.onlinelibrary.wiley.com/doi/full/10.1049/cmu2.12759)

## User-supplied manuscripts

- \[U1\] A finite Smith-Toda complex V(4) at the prime 1009. Uploaded as paper (2).pdf; title page dated 23 Sep 2026.

- \[U2\] A zero-entropy system without a smooth positive-volume model. Uploaded as paper (3).pdf; title page dated 25 Sep 2026.

- \[U3\] Abelian covers, Gale correspondences, and the Hodge conjecture for powers. Uploaded as paper (4).pdf; title page dated 6 Oct 2026.

- \[U4\] A Counterexample to Kaplansky's Direct-Finiteness Conjecture in Odd Characteristic. Uploaded as paper.pdf; title page dated 26 Sep 2026.

- \[U5\] A counterexample to the nearby Lagrangian conjecture. Uploaded as paper (1).pdf; title page dated 23 Sep 2026.

Research method: 22 targeted web search queries were run; official standards and source repositories were prioritized for protocol claims, and recent papers were used to identify adjacent approaches. Search results are not exhaustive; the novelty and freedom-to-operate status of the product concept remain unproven.

**APPENDIX A**

# Technical appendix: verifier semantics and invariants

*Define exactly what PASS means for each proof profile.*

## Verifier result taxonomy

| **Result**           | **Meaning**                                                                                                            | **Release behavior**                                                                                   |
|----------------------|------------------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------|
| PASS-COMMITMENT      | The observed payload/blocks match the committed root under the declared canonicalization and key epoch.                | Necessary, never sufficient by itself.                                                                 |
| PASS-LINEAGE         | All required parent capsule references resolve and the declared graph is complete for the supported connector/profile. | Allows next gate only when profile says lineage scope is complete.                                     |
| PASS-POLICY          | A specified versioned policy evaluator returned allow and the digest matches the capsule.                              | Decision applies only to specified data, purpose, principal, and time window.                          |
| PASS-ATTESTATION     | Evidence matches a selected RATS appraisal policy.                                                                     | Shows expected measurement/claims according to verifier policy; not proof of no runtime vulnerability. |
| PASS-QUERY-PROFILE   | A proof backend covers the declared query operation, or an attested deterministic executor ran the supported profile.  | Never infer arbitrary-SQL correctness from a query hash or result root.                                |
| PASS-TRANSPARENCY    | Receipt inclusion and consistency proofs validate; independent witnesses do not report a conflicting history.          | Strong tamper evidence under stated witness assumptions.                                               |
| FAIL / INDETERMINATE | A required check fails, evidence is missing/stale, or a security assumption cannot be validated.                       | Fail closed for high-risk release; emit named remediation action.                                      |

## Pseudo-protocol (informative)

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p>1. Source agent canonicalizes snapshot S and computes root R_S.</p>
<p>2. Agent emits source/snapshot statement with schema + key epoch.</p>
<p>3. Transform runner declares parent roots, image digest, query profile Q.</p>
<p>4. Policy engine evaluates P(principal, purpose, data-labels, time).</p>
<p>5. Optional RATS verifier appraises execution evidence E.</p>
<p>6. Runner computes result root R_O; capsule digest binds R_S, Q, P, E, R_O.</p>
<p>7. Transparency service records statement; witnesses retain receipt/checkpoint.</p>
<p>8. Independent verifier checks capsule, Merkle proofs, graph, policy, E, receipt.</p>
<p>9. Release gate issues output only when required profile checks PASS.</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## Operational invariants

- Each cryptographic object identifies algorithm, version, serialization, and key epoch; silent algorithm substitution is forbidden.

- No root or receipt is trusted solely because the SEAMDB application says it verifies; independent implementations and test vectors are a strategic goal.

- When source data changes after capsule issue, issue a new capsule with parent links; do not mutate an existing statement in place.

- Retention/deletion policy applies to raw data, keys, metadata, proof material, and backup replicas separately. Explain where cryptographic erasure is possible and where receipts necessarily persist.

- Privacy review covers leakage from timestamps, partition sizes, row counts, access patterns, and overlap reports, not just plaintext bytes.

**APPENDIX B**

# Technical appendix: build priorities and final call

*The winning research program is the one that survives customer contact.*

## Prioritized research questions

| **Priority** | **Question**                                                                                  | **Evidence required to promote**                                                                                  |
|--------------|-----------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------|
| P0           | Can a capsule bind one real pipeline end-to-end with verifiable roots and auditable policy?   | Independent verifier passes positive and negative test suite; a customer uses the report.                         |
| P0           | Can the product discover missing parents, stale policies, and log equivocation?               | Fault-injection tests plus witness consistency check.                                                             |
| P0           | Can a supported TLS stack negotiate hybrid key establishment with sensible fallback control?  | Interop matrix, packet-level confirmation, performance benchmark, current standard/errata review.                 |
| P1           | Does the mismatch graph detect cross-system contradictions with tolerable alert burden?       | Labelled corpus, precision/recall, adjudication process, business-owner sign-off.                                 |
| P1           | Does MDL-based drift improve detection beyond policy/invariant rules?                         | Pre-registered comparison against simple baselines; no data-content leakage.                                      |
| P2           | Can a restricted transformation DSL benefit from Gröbner-basis or symbolic constraint checks? | Small real workload and formal statement of the exact property proved.                                            |
| P2           | Can ZK query proofs support a commercially valuable subset without prohibitive cost?          | Prototype against published systems such as PoneglyphDB; report prover/verifier cost and supported SQL semantics. |
| P2           | Does sheaf cohomology add actionable signal beyond graph consistency checks?                  | A domain where nontrivial obstruction correlates with a verified data defect and outperforms simpler checks.      |

## 90-day founder plan

1.  Days 1-15: interview 15-20 qualified buyers; secure one design partner; map one painful data release; write a proof guarantee catalog.

2.  Days 16-35: build read-only connector, deterministic capsule serialization, Merkle commitment, offline verifier, and fail-closed release policy.

3.  Days 36-60: add lineage ingestion, transparency receipts/witnesses, two-source overlap rules, and hybrid-TLS capability tests.

4.  Days 61-75: run adversarial tests and ANOVA-style performance experiment; produce a customer-grade evidence dossier.

5.  Days 76-90: price and close paid pilot/renewal; decide whether to invest in RATS, symbolic constraints, or ZK only from measured demand.

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>FINAL RECOMMENDATION</strong></p>
<p>Build SEAMDB as a verifiable data-release layer, not a new database and not a custom cryptosystem. Start with one auditable AI data handoff. Use ML-KEM hybrid transport, SCITT-style transparency, RATS-style execution appraisal, Merkle evidence, and sheaf-inspired cross-view consistency. Add Kolmogorov/MDL and algebraic-geometry modules only if they improve measured outcomes.</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

Novelty caveat: this is a differentiated product hypothesis, not a claim of globally unique prior art. Verify competitors, patents, and freedom to operate before committing to a public launch.

**PART II / ENGINEERING SPECIFICATION**

# IMPLEMENTATION EDITION: FROM THESIS TO RUNNABLE SYSTEM

*The remaining chapters translate SEAMDB into an engineering plan. The protocol, schemas, gates, and performance targets below are proposed design decisions, not an existing standard or a completed product.*

The objective is to ship a narrow verifiable data-release workflow before expanding into general query proving. Every security property must map to (a) a data structure, (b) a verifier check, (c) a negative test, and (d) an explicit assumption.

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>OPERATING PRINCIPLE</strong></p>
<p>Cryptographic primitives are imported, not invented. SEAMDB defines orchestration and evidence semantics; it does not implement its own cipher, key exchange, signature algorithm, hash function, TLS stack, or bespoke proof system.</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

| **Build tier**       | **Ships with**                                                                                                                           | **Explicit non-goal**                                                           |
|----------------------|------------------------------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------|
| P0 / MVP             | Dataset snapshot commitment, lineage, OPA policy gate, capsule bundle, Merkle receipt, offline verifier.                                 | Proof of arbitrary SQL semantics; full encrypted query processing.              |
| P1 / Paid enterprise | Independent witnesses, hybrid PQ transport where supported, richer connector coverage, SCITT-style statements, RATS integration profile. | Universal proof of a malicious source being truthful.                           |
| P2 / Research        | Sheaf obstruction analytics, MDL/algorithmic anomaly scores, restricted symbolic query reasoning, optional ZK proof backend.             | Any claim that mathematical novelty automatically implies operational security. |

**21 / ARCHITECTURE**

# System boundaries and trust domains

*Keep the trusted computing base small, observable, and replaceable.*

| **Boundary**         | **Components**                                                                      | **Trust rule / deployment rule**                                                                          |
|----------------------|-------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------|
| Customer data plane  | Postgres / warehouse / Iceberg / object store; capture agents; transform jobs.      | Raw rows stay in customer-controlled systems by default; agents are read-only in MVP.                     |
| SEAMDB control plane | API gateway, tenant registry, policy evaluator, release coordinator.                | May authorize but cannot silently mutate source snapshots; separated admin identity and runtime identity. |
| Evidence plane       | Canonicalizer, commitment worker, capsule store, lineage index, discrepancy engine. | Deterministic serialization; proof bundles content-addressed; events idempotent and replay-safe.          |
| Trust plane          | KMS/HSM, workload identity, verifier, transparency log, independent witnesses.      | No service should both create all evidence and be the sole party verifying it.                            |
| Consumer plane       | AI pipeline, partner export, model registry, auditor CLI.                           | Consumer receives data plus capsule or a reference to the capsule; use receipt checks before ingest.      |

## Required network zones

- Zone A: source connector subnet. Egress allow-list only to the source, internal queue, and required identity endpoint. No internet egress by default.

- Zone B: evidence services. Private service mesh, workload identities, separate KMS permissions for commitment-key access and capsule-decryption keys.

- Zone C: witnesses/transparency. Separate account/project or customer-controlled witness. This separation makes a control-plane compromise less able to rewrite the whole evidence history.

- Zone D: auditor/verifier. Offline-capable CLI; accepts exported bundle and pinned trust roots. No trust in UI status labels without underlying proof validation.

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>FAILURE ISOLATION</strong></p>
<p>A witness outage can delay a high-assurance release, but it must not corrupt existing capsules. Policy can define “one witness + local receipt” for low risk and “quorum of independent witnesses” for high risk.</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

**22 / RUNTIME**

# Service topology, runtime contracts, and ports

*The first deployment should be a private single-tenant control plane with optional isolated witnesses.*

| **Service**          | **Suggested runtime**                     | **Input / output contract**                                                                                                    |
|----------------------|-------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------|
| capture-agent        | Go or Rust; systemd/Kubernetes deployment | Reads bounded source metadata and rows/snapshot IDs; emits signed-by-workload-identity capture events; local queue is durable. |
| control-api          | Go or Python/FastAPI                      | OpenAPI-validated REST; OIDC principal; tenant-scoped authorization; idempotency keys required for mutating calls.             |
| event-ingestor       | Go worker + queue                         | Validates event schema/version; deduplicates by event_id; writes transactional outbox and raw event digest.                    |
| capsule-builder      | Go/Rust worker                            | Canonicalizes typed statements; checks parent closure and policy binding; emits immutable capsule object.                      |
| commitment-service   | Go/Rust library in worker                 | Batched SHA-384 Merkle commitment; no raw payload persisted unless customer opts in.                                           |
| policy-engine        | OPA sidecar or service                    | Versioned Rego bundle; decision has policy digest, input digest, allow/deny, expiry and obligations.                           |
| transparency-adapter | Go worker                                 | Submits canonical statement to SCITT-style service or internal append-only Merkle log; returns inclusion/consistency proof.    |
| verifier-cli         | Rust or Go binary                         | Pure verification library; accepts bundle, trust roots, and policy profile; exits 0 only when all required checks pass.        |

## Runtime interface conventions

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p>HTTP JSON: application/json; charset=utf-8</p>
<p>API version: /v1; incompatible envelope changes require /v2 or explicit profile version</p>
<p>Mutations: Idempotency-Key required; duplicate key + different body =&gt; 409</p>
<p>Trace: W3C traceparent; no raw SQL parameter values in spans</p>
<p>Identity: SPIFFE ID or workload identity mapped to tenant + role; no long-lived shared service token</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

Use OpenTelemetry database semantic conventions, but do not collect unredacted query literals or parameter values. Instrument query profiles and digests rather than patient names, account numbers, or other payload-bearing attributes. \[R7\]

**23 / DATA MODEL**

# Core data model and transactional invariants

*Use relational metadata with content-addressed immutable payloads.*

| **Table**             | **Critical columns**                                                                        | **Constraints / index strategy**                                                               |
|-----------------------|---------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------|
| tenants               | tenant_id, crypto_domain, policy_root, status                                               | crypto_domain unique; tenant state gates every control-plane operation.                        |
| sources               | source_id, tenant_id, kind, locator_ref, connector_version                                  | unique(tenant_id, source_id); secret references stored in KMS, never as plaintext.             |
| snapshots             | snapshot_id, source_id, schema_digest, root_digest, row_count, snapshot_token, crypto_epoch | unique(source_id, snapshot_token, canonicalization_version); immutable once sealed.            |
| jobs                  | job_id, tenant_id, transform_digest, image_digest, status                                   | status state machine; input event version and result timestamps tracked.                       |
| capsules              | capsule_id, capsule_digest, profile, state, created_at                                      | capsule_digest unique; sealed capsules immutable; latest state represented by appended events. |
| lineage_edges         | child_capsule_id, parent_capsule_id, relation                                               | no self-edge; cycle detection on finalize; indexes from both ends.                             |
| policy_decisions      | decision_id, capsule_id, policy_digest, input_digest, outcome, expires_at                   | append-only decision record; stale decisions cannot authorize a later snapshot.                |
| transparency_receipts | receipt_id, capsule_id, log_id, tree_size, root_digest, proof_ref                           | immutable receipt bytes; verify log identity and tree consistency.                             |
| coherence_findings    | finding_id, scope_id, severity, witness_digest, disposition                                 | finding lifecycle separate from source data; disposition requires an actor and rationale.      |
| verification_runs     | run_id, capsule_id, verifier_version, verdict, failed_checks, trust_root_digest             | never overwrite a failure with PASS; append a new run with new verifier version.               |

## Transactions and state invariants

- Use a transactional outbox when committing metadata and emitting events. Exactly-once delivery is not assumed; consumers are idempotent.

- Capsule sealing is one database transaction that checks required parents, fresh policy decision, result digest presence, and crypto epoch, then writes the immutable digest.

- External transparency submission is asynchronous. Capsule state may be SEALED_PENDING_RECEIPT, but the release gate requires RECEIPT_VERIFIED for the selected assurance profile.

- Use serializable or explicit optimistic concurrency for same-capsule finalization. Conflicting transitions return 409 and preserve the winning immutable record.

- Retention removes payloads and optional sensitive metadata according to policy; tombstones and audit receipts remain where legally and contractually required.

**24 / SCHEMA**

# Evidence Capsule v1: canonical wire object

*A capsule binds source state, transformation, authorization, execution, result, and receipt into one digest.*

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p>EvidenceCapsule = {</p>
<p>"spec": "seamdb.capsule/v1",</p>
<p>"tenant_ref": "opaque-tenant-id",</p>
<p>"capsule_id": "uuid",</p>
<p>"created_at": "RFC3339 UTC",</p>
<p>"source": {"source_ref":"opaque", "snapshot_ref":"opaque",</p>
<p>"schema_sha384":"hex", "root_sha384":"hex",</p>
<p>"row_count": 0, "canonicalizer":"canon/v1"},</p>
<p>"transform": {"image_digest":"sha256:...", "code_digest":"sha384:...",</p>
<p>"query_profile":"tabular-export/v1", "query_digest":"sha384:..."},</p>
<p>"parents": [{"capsule_digest":"sha384:...", "edge":"derived_from"}],</p>
<p>"policy": {"bundle_digest":"sha384:...", "decision_digest":"sha384:...",</p>
<p>"purpose":"model-training", "destination_ref":"opaque"},</p>
<p>"execution": {"profile":"none|rats-profile-id", "evidence_digest":null},</p>
<p>"result": {"root_sha384":"hex", "row_count":0, "schema_sha384":"hex"},</p>
<p>"crypto": {"hash":"SHA-384", "key_epoch":"tenant-key-epoch-17"},</p>
<p>"transparency": {"statement_digest":"sha384:...", "receipt_ref":null},</p>
<p>"assurance_profile":"SEAMDB-BASELINE-1"</p>
<p>}</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## Canonicalization rules

- For JSON use RFC 8785 JCS or deterministic CBOR (RFC 8949) consistently per profile. Never hash arbitrary pretty-printed JSON.

- Normalize timestamps to UTC RFC3339 precision defined by the profile; normalize numbers and Unicode under a declared rule; reject NaN/Infinity and ambiguous duplicate keys.

- Hash with explicit domain separation and schema version, e.g. SHA384("SEAMDB/CAPSULE/V1\0" \|\| canonical_bytes).

- IDs are opaque random values; do not expose primary keys, tenant names, source table names, or raw values in public log leaf fields.

- No null/missing ambiguity: required fields must be present; optional fields are omitted, not silently coerced into null unless the schema explicitly says so.

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>CAPSULE IS NOT A SIGNATURE</strong></p>
<p>The capsule digest commits to contents; a receipt authenticates a transparency-log statement under the chosen log identity; source truth and software execution are separate claims with separate evidence.</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

**25 / PROTOCOL**

# SECP/0.1: proposed niche exchange protocol

*SEAMDB Evidence Capsule Protocol (SECP) is a proposed application-layer state machine, not an IETF or ISO standard.*

| **State**           | **Required artifact**                                                         | **Transition guard**                                                                                      |
|---------------------|-------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------|
| INTENT_CREATED      | Intent: purpose, destination, query profile, max rows/bytes, deadline, nonce. | Principal authenticates; tenant and destination exist.                                                    |
| SOURCE_COMMITTED    | Snapshot root, schema digest, source token, canonicalizer profile.            | Connector declares snapshot semantics; source watermark and isolation mode recorded.                      |
| LINEAGE_CLOSED      | Parent capsule set and transformation digest.                                 | All mandatory parent refs resolve; directed lineage graph is acyclic for this release.                    |
| POLICY_APPRAISED    | Policy digest + decision digest + obligations.                                | Decision allow; TTL valid; intent/source/result scope and destination match exactly.                      |
| EXECUTION_APPRAISED | Optional RATS evidence reference and appraisal result.                        | If profile requires it: nonce fresh, claims issuer trusted, measurement in allowlist, evidence not stale. |
| RESULT_COMMITTED    | Output schema/root/count + execution profile.                                 | Output is linked to actual release bytes/object manifest; row/byte limits enforced.                       |
| CAPSULE_SEALED      | Canonical capsule digest + parent digest list.                                | All required fields complete; state transition uses compare-and-swap.                                     |
| RECEIPT_VERIFIED    | Inclusion proof + checkpoint + consistency proof + witness evidence.          | Pinned log identity valid; inclusion and append-only checks pass; witness requirement met.                |
| RELEASED            | One-time release grant scoped to digest, destination, TTL, and nonce.         | Verifier passes; release grant unexpired and unused; high-severity finding closed or exception approved.  |

## Message exchange

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p>Consumer -&gt; Control API: CreateIntent(intent, idempotency_key)</p>
<p>Agent -&gt; Evidence API: CommitSnapshot(source_ref, snapshot_ref, schema, root)</p>
<p>Job runner -&gt; API: PublishTransform(parent_capsules, image_digest, query_digest, result_root)</p>
<p>Policy engine -&gt; API: PolicyDecision(decision_digest, allow, obligations, expiry)</p>
<p>Attester -&gt; Appraiser: Evidence(evidence_ref, nonce, measurements, issuer)</p>
<p>Transparency -&gt; API: Receipt(statement_digest, inclusion_proof, checkpoint, consistency_proof)</p>
<p>Verifier -&gt; Release Gate: Verify(bundle, trust_roots, profile) =&gt; PASS | FAIL + failure_codes</p>
<p>Release Gate -&gt; Consumer: SingleUseGrant(capsule_digest, destination, expires_at, nonce)</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>REPLAY DEFENSE</strong></p>
<p>Every mutating exchange is bound to tenant, capsule intent ID, destination, nonce, policy digest, source root and expiry. Store nonce consumption atomically; duplicate request with same idempotency key and same body returns the original result, while mismatched body returns conflict.</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

**26 / CRYPTOGRAPHY**

# Cryptographic profile and post-quantum rollout

*Use standardized components and explicit algorithm agility. No post-quantum signature scheme is used in this design.*

| **Function**       | **Proposed profile**                                                                                                                                             | **Required guardrail**                                                                                                                              |
|--------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------|
| Key establishment  | Hybrid TLS 1.3 using X25519 + ML-KEM-768 where the selected TLS/library stack supports interoperable hybrid groups. NIST standardized ML-KEM in FIPS 203. \[R1\] | Verify negotiated group in integration tests; fail or apply an explicitly approved fallback policy. Do not label classical fallback “post-quantum”. |
| Payload encryption | AES-256-GCM or ChaCha20-Poly1305 via maintained libraries; envelope encryption with per-object DEK wrapped by KMS/HSM KEK.                                       | Unique nonce per key; authenticated context binds tenant/object/type/key epoch; use AEAD library APIs, not bespoke modes.                           |
| Commitment hash    | SHA-384 with domain separation for capsule, row, partition and Merkle-node objects.                                                                              | Schema-versioned canonical input; known-answer tests; hash algorithm recorded in every artifact.                                                    |
| Workload identity  | SPIFFE/SPIRE X.509-SVID or cloud workload identity plus mTLS. \[R8\]                                                                                             | Identity lifetime short; trust bundle rotation; precise SPIFFE ID-to-tenant mapping.                                                                |
| Checkpoint signer  | Classical Ed25519 or approved enterprise PKI signature for v1 transparency checkpoints.                                                                          | Explicitly NOT post-quantum. Pinned log identity, external witnesses and migration plan; this leaves long-term quantum forgery risk.                |
| Key custody        | KMS/HSM; separated KEK, tenant commitment secret, DEK and checkpoint key roles.                                                                                  | No application DB access to private key bytes; dual control for root-key change; rotation drill before production.                                  |

## Key hierarchy and contexts

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p>tenant KEK (KMS/HSM)</p>
<p>├─ wraps object DEKs (one or more per object/rotation epoch)</p>
<p>├─ protects tenant commitment secret used for keyed leaves where low-entropy guessing is a risk</p>
<p>└─ is not the transparency checkpoint signing key</p>
<p>AEAD associated data = tenant_id || object_id || object_type || schema_version || key_epoch</p>
<p>Key epoch is monotonically increasing per domain; revoked epochs reject new encryptions.</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>HYBRID TRANSPORT BOUNDARY</strong></p>
<p>ML-KEM protects establishment of fresh session key material against the relevant quantum-capable passive adversary model; it does not retroactively protect prior classical-only captures, remove endpoint compromise, or solve signature longevity. [R1]</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

**27 / CONNECTORS**

# Snapshot capture and connector semantics

*A root is only meaningful if its snapshot boundary and canonicalization are defined.*

| **Connector pattern** | **Capture algorithm**                                                                                                                                                                              | **Known caveats**                                                                                                                                                                                               |
|-----------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| PostgreSQL MVP        | Read-only role; consistent transaction snapshot; enumerate schema/version; stream rows in primary-key order or declared stable order; canonicalize typed row envelopes; build per-partition roots. | Long-running repeatable-read snapshots may increase vacuum pressure. Record WAL LSN/snapshot token and test replica lag. PostgreSQL RLS is defense-in-depth, not a substitute for SEAMDB release policy. \[R6\] |
| Iceberg / lakehouse   | Bind metadata JSON + snapshot ID + manifest-list digest + schema/spec IDs; resolve data file manifests; hash file content or signed object manifests per profile.                                  | Snapshot metadata root proves referenced metadata, not necessarily that every external file was immutable unless object-store and file digests are included. \[R9\]                                             |
| Kafka / CDC           | Record topic/partition offsets, schema registry ID, event range, event digest and watermark vector.                                                                                                | There is no single global total order across partitions; express frontier/watermark and gap policy explicitly.                                                                                                  |
| Warehouse API         | Use vendor snapshot/time-travel token where semantics are documented; otherwise classify capture as best-effort and never overstate atomicity.                                                     | Source token TTL and data-change model vary; connector tests must detect expired snapshots or unstable pagination.                                                                                              |

## Connector state machine

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p>DISCOVER -&gt; VALIDATE_CREDENTIALS -&gt; PIN_SCHEMA -&gt; ACQUIRE_SNAPSHOT</p>
<p>-&gt; ENUMERATE_PARTITIONS -&gt; HASH_CONTENT -&gt; VERIFY_COUNTS -&gt; EMIT_COMMIT</p>
<p>Failure anywhere =&gt; FAILED_CAPTURE; do not emit a sealed root. Retry only idempotent phases.</p>
<p>Connector manifest fields: source_ref, connector_version, source_version_token,</p>
<p>snapshot_mode, isolation_level, partition_plan_digest, schema_digest, root_digest,</p>
<p>row_count, byte_count, started_at, completed_at, lag/watermark, warnings[].</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

For the first commercial wedge, support a single source type end-to-end before generalizing. Add connectors through a conformance suite instead of trusting that similar-looking vendor APIs have equivalent snapshot semantics.

**28 / AUTHORIZATION**

# Policy gates, OPA, and one-use release grants

*Separate “the query may run” from “this result may leave the trust boundary.”*

## Decision input contract

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p>{"principal":"spiffe://tenant/workload/model-exporter",</p>
<p>"purpose":"model-training", "source_root":"sha384:...",</p>
<p>"destination":"partner://opaque/data-contract-17",</p>
<p>"data_classes":["regulated","pseudonymized"],</p>
<p>"query_profile":"tabular-export/v1", "max_rows":500000,</p>
<p>"max_bytes":1073741824, "capsule_intent":"uuid",</p>
<p>"policy_bundle_digest":"sha384:...", "issued_at":"...", "expires_at":"..."}</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## OPA/Rego policy skeleton

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p>package seamdb.release</p>
<p>default allow := false</p>
<p>allow if {</p>
<p>input.purpose in data.seamdb.allowed_purposes</p>
<p>input.destination in data.seamdb.allowed_destinations</p>
<p>input.max_rows &lt;= data.seamdb.max_rows</p>
<p>input.policy_bundle_digest == data.seamdb.bundle_digest</p>
<p>not input.data_classes[_] in data.seamdb.denied_classes</p>
<p>}</p>
<p>require_attestation if {</p>
<p>input.data_classes[_] == "regulated"</p>
<p>}</p>
<p># Production policy must validate policy freshness, tenant mapping,</p>
<p># key epoch, destination binding, approval status and explicit obligations.</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## Grant rules

- Grant lifetime: begin with 60-300 seconds; tune from measured workflow latency. Never turn a release grant into a reusable bearer token.

- Grant audience must be exact destination/workload identity; scope to one capsule digest, policy decision digest, row/byte ceilings, and nonce.

- Consume the grant atomically before returning data bytes or presigned download credentials. Idempotent retries return same job status, not a second release.

- Break-glass bypass requires a second approver, incident reference, expiry, reason, and a separate audit event. Bypass never becomes silent PASS.

- Policy bundle updates are versioned and approved through separate author/deployer roles. Capsule retains the exact digest used at decision time.

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>FAIL-CLOSED CASES</strong></p>
<p>Missing parent, expired policy, unrecognized source version, stale attestation, invalid receipt, unresolved critical mismatch, unknown schema/canonicalizer version, or reused nonce =&gt; deny release and emit a stable failure code.</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

**29 / API**

# REST API and idempotency contract

*Start with a small versioned API; every endpoint must have authorization and failure semantics.*

| **Endpoint**                            | **Purpose**                                   | **Success / errors**                                                                     |
|-----------------------------------------|-----------------------------------------------|------------------------------------------------------------------------------------------|
| POST /v1/intents                        | Create scoped release intent.                 | 201 intent; 400 schema; 403 policy; 409 idempotency mismatch.                            |
| POST /v1/sources/{id}/snapshots         | Register snapshot commitment.                 | 202 queued / 201 committed; 404 source; 422 inconsistent counts; 409 duplicate conflict. |
| POST /v1/jobs/{id}/events               | Ingest OpenLineage-compatible run event.      | 202 accepted; 409 event ID collision; 422 unsupported schema version.                    |
| POST /v1/capsules                       | Seal capsule against supplied references.     | 201 sealed; 409 state conflict; 422 missing parent / invalid digest / cycle detected.    |
| GET /v1/capsules/{id}/bundle            | Retrieve allowed evidence bundle.             | 200 bundle; 304 ETag match; 403 insufficient scope; 410 payload expired.                 |
| POST /v1/verifications                  | Run a named verifier profile.                 | 200 verdict PASS/FAIL; 422 malformed bundle; 503 dependency unavailable.                 |
| POST /v1/releases/{profile}/authorize   | Request one-use release grant.                | 201 grant; 403 denied; 409 replay/state conflict; 423 pending receipt/witness quorum.    |
| GET /v1/transparency/{statement_digest} | Fetch proof, checkpoint and witness receipts. | 200 proof envelope; 404 unknown; 503 quorum/proof service unavailable.                   |

## Request processing contract

- Validate content type, maximum body size, schema version and tenant before business logic. Reject duplicate JSON keys and non-finite numeric encodings.

- Enforce authorization at the object level. Checking only “authenticated” is insufficient; the principal must be authorized for the requested tenant, capsule, source and destination.

- Use \`Idempotency-Key\` for mutation endpoints and store request-body digest plus original outcome for at least the retry window.

- Paginate lists with opaque cursors bound to tenant and query filters; never expose sequential IDs across tenants.

- Error shape: \`{code, message, retryable, request_id, details\[\]}\`. Details contain opaque references, not source values or secrets.

**30 / VERIFICATION**

# Merkle commitments, proof bundles, and verifier semantics

*Distinguish tamper evidence, inclusion, completeness, execution correctness, and source truth.*

| **Proof class**               | **What verifier can establish**                                                                                | **What it cannot establish alone**                                                                            |
|-------------------------------|----------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------|
| Snapshot root                 | The canonicalized inputs observed at capture produce the committed root.                                       | That the source was honest, that capture included all intended rows, or that business semantics were correct. |
| Row/partition inclusion proof | A leaf is included under a committed root, subject to the tree profile.                                        | That no eligible row was omitted unless the proof profile also establishes range/completeness.                |
| Transparency inclusion        | A statement digest appears under a checkpoint.                                                                 | That the statement content is true; inclusion only commits to the submitted statement.                        |
| Consistency proof + witness   | One checkpoint is an append-only extension of a previous checkpoint; witnesses can expose split-view behavior. | That all witnesses are independent, or that a colluding quorum cannot equivocate.                             |
| Execution attestation         | Measured environment claims satisfy a configured appraisal policy.                                             | That code has no bug, side channel, or runtime exploit after appraisal.                                       |
| Query proof / restricted DSL  | A declared relation was computed correctly within an exact proof backend/profile.                              | Arbitrary SQL correctness or completeness outside that profile.                                               |

## Binary Merkle profile

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p>leaf_hash = SHA384(0x00 || "SEAMDB/LEAF/V1" || canonical_leaf_bytes)</p>
<p>node_hash = SHA384(0x01 || "SEAMDB/NODE/V1" || left_hash || right_hash)</p>
<p>root_commitment = SHA384("SEAMDB/ROOT/V1" || schema_digest || partition_id || tree_root)</p>
<p>Odd-node handling, empty-tree semantics, leaf ordering, partition boundaries,</p>
<p>and proof serialization are fixed in the profile specification and test vectors.</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

Use a vetted transparency/Merkle library or a small independently tested implementation. Pin the checkpoint signing key and log ID. Require checkpoint authenticity, inclusion, consistency, and witness requirements separately. The Rekor specification describes the utility of Merkle inclusion and consistency proofs for tamper-evident append-only logs. \[R3\]

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>VERIFIER OUTPUT MUST BE EXPLAINABLE</strong></p>
<p>Return verdict + named checks (CANONICALIZATION, SOURCE_ROOT, LINEAGE_CLOSURE, POLICY_BINDING, APPRAISAL, INCLUSION, CONSISTENCY, WITNESS_QUORUM, RELEASE_SCOPE) with artifact references and deterministic failure codes.</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

**31 / MATHEMATICAL MODULE I**

# Sheaf-inspired cross-view coherence engine

*Model overlapping data views as local sections and explicit restriction maps; treat cohomology as a diagnostic research direction.*

## Operational model

Let G=(V,E) be a graph or hypergraph of source views, transformed tables and governed outputs. Each node v carries a local dataset/schema section X_v and metadata context. Each edge e=(u,v) carries an overlap domain O_e and a restriction/mapping operator r\_{v-\>e}. A comparison function d_e measures disagreement after both sides are mapped to a common canonical domain.

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p>m_e = d_e(r_{u-&gt;e}(X_u), r_{v-&gt;e}(X_v))</p>
<p>local_alert(e) = 1[m_e &gt; tau_e OR mapping_version_mismatch(e)]</p>
<p>For a cycle C = (v0 -&gt; v1 -&gt; ... -&gt; vk=v0), compose the declared</p>
<p>restriction/transform maps. If composition does not preserve the expected</p>
<p>section on shared keys, emit cycle_witness(C, keys_digest, map_digests, residual).</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## MVP algorithm (pragmatic before topology)

- Declare overlap keys and units per domain: member ID, currency, UTC timestamp, code set, product ID, etc. Avoid fuzzy matching as a security invariant.

- Apply versioned deterministic mappings into a canonical comparison space. Unknown mapping version means “not comparable,” not “consistent.”

- Compute equality/range/conservation checks first; then build cycles or hyperedges to locate clusters of contradictory local views.

- Emit a minimal reproducible witness: opaque row IDs, source snapshot roots, mapping digests, field names, discrepancy class, residual magnitude and review status.

- Only promote a sheaf-cohomology-derived score if a labelled field study demonstrates incremental precision/recall or faster root-cause localization over the rule/graph baseline.

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>WHY SHEAVES DO NOT GRANT SECURITY</strong></p>
<p>The mathematical framework can organize consistency conditions and obstructions. It does not prove source completeness, correctness of mappings, or secrecy. Security value comes from explicit mappings, verifiable inputs, and tested detection performance.</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

**32 / MATHEMATICAL MODULE II**

# Kolmogorov complexity, MDL, and ANOVA validation

*Use complexity-inspired statistics to prioritize investigations, never as a cryptographic integrity primitive.*

## Algorithmic-complexity-inspired anomaly score

True Kolmogorov complexity K(x) is not computable in general. Implement a computable Minimum Description Length (MDL) proxy on carefully chosen, non-sensitive summaries: compression residual, grammar/model code length, schema-transition surprisal, graph motif count, and drift from an approved baseline. Do not name a compressor score “Kolmogorov complexity” without a formal qualification.

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p>score(x) = L(model) + L(x | model) - L(reference_model) - L(reference_window)</p>
<p>features = [schema_delta, null_rate, cardinality_delta, join_ratio,</p>
<p>graph_edit_cost, row_count_residual, lineage_branch_delta]</p>
<p>alert iff score exceeds calibrated threshold AND critical invariant fails</p>
<p>OR score exceeds high-confidence threshold after human-review policy</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## Factorial experiment plan (ANOVA)

| **Factor**            | **Levels**                                                          | **Response variables**                                         |
|-----------------------|---------------------------------------------------------------------|----------------------------------------------------------------|
| Capture mode          | No capture / hash-only / full capsule                               | p50/p95/p99 latency; CPU seconds; bytes per million rows.      |
| Transport             | Classical TLS baseline / supported hybrid X25519+ML-KEM             | Handshake latency; CPU; failure rate; connection reuse impact. |
| Lineage topology      | Single source / two sources / multi-parent DAG                      | Capture lag; closure-check time; duplicate/missing-edge rate.  |
| Workload class        | OLTP metadata / analytic snapshot / bulk export                     | Throughput; memory; proof generation and verification time.    |
| Adversarial condition | Clean / stale policy / missing parent / root tamper / witness split | Detection rate; false allow rate; alert latency.               |

Pre-register main effects and interactions; randomize run order; include independent replicate runs; report confidence intervals and effect sizes, not only p-values. Use mixed-effects models if host/tenant/source variation creates repeated-measures structure. The decision target is not “statistically significant” alone: quantify overhead and whether the detection gain changes a release decision.

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>SAFETY GATE</strong></p>
<p>No model-based anomaly score may override a cryptographic verification failure or policy denial. A low anomaly score is not evidence of integrity.</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

**33 / MATHEMATICAL MODULE III**

# Algebraic geometry and symbolic constraints research lane

*A bounded symbolic checker can verify selected transformation invariants; do not imply it solves arbitrary SQL.*

## Candidate application

Represent restricted transformation profiles as polynomial/rational constraints over a declared field or ring: linear projections, group-by conservation, unit conversions with exact rational constants, interval constraints, referential maps, and small deterministic feature transforms. A symbolic verifier can ask whether a bad-state ideal has a solution or whether two transformations are equivalent under declared assumptions.

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p>I = &lt;f1(x), ..., fn(x)&gt; # assumptions / schema constraints</p>
<p>B = &lt;g1(x), ..., gm(x)&gt; # bad-output conditions</p>
<p>Question: is V(I + B) empty over the declared domain?</p>
<p>Optional: Groebner basis / elimination only for bounded dimensions and degree.</p>
<p>Output: proof profile, ring/field, variables, constraints digest, solver version,</p>
<p>resource cap, result (UNSAT/SAT/UNKNOWN), counterexample digest if SAT.</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## Promotion requirements

- Begin with a tiny DSL, exact arithmetic and bounded variables. Do not parse general SQL into a claim the checker can prove unless semantics are fully specified.

- UNKNOWN, timeout, unsupported operator, floating-point ambiguity or solver overflow must not be treated as UNSAT/verified.

- Persist solver version, domain assumptions, transformation profile digest and the exact statement being proved.

- Use property-based generation and independently check returned witnesses. Cross-check small cases with exhaustive enumeration where feasible.

- Run algebraic reasoning off the release-critical path until the proof profile and implementation receive formal review.

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>RESEARCH MAPPING</strong></p>
<p>The supplied Hodge/Gale manuscript emphasizes transfer through explicit correspondences and restrictions to generic loci. The analogous engineering rule is: symbolic transfer is valid only when the mapping and its preconditions are declared, versioned, and satisfied.</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

**34 / PRIVACY**

# Privacy, redaction, metadata leakage, and computer vision

*Visual interfaces must make evidence legible without exposing the underlying regulated data.*

| **Risk surface**                                    | **Implementation control**                                                                                                          | **Verification test**                                                                              |
|-----------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------|
| Stable low-entropy row hashes                       | Per-tenant keyed commitments for sensitive leaves; never publish unsalted hashes of emails, phone numbers or IDs.                   | Attacker with public capsule cannot confirm guessed row values without a key.                      |
| Metadata side channel                               | Bucket counts where acceptable; opaque source IDs; minimize timestamps/partition names in externally visible receipts.              | Threat review against row count, timing, and rare-schema inference.                                |
| Query telemetry                                     | Redact literals and parameter values; capture query profile/digest; restricted debug sampling.                                      | Automated log scan with seeded canary PII; CI fails on leak.                                       |
| Evidence UI                                         | Role-based fields; reveal payload metadata only on explicit authorized action; no default rendering of record-level values.         | Screenshot/accessibility review with viewer/operator/auditor roles.                                |
| Computer-vision/document ingestion (optional later) | Use OCR/document layout extraction only as an untrusted parser; retain source-object digest and reviewer-approved extracted schema. | Fuzzed PDFs/images, OCR ambiguity, adversarial document, duplicate-page and hidden-layer fixtures. |
| AI/ML data profiling                                | Use statistics on approved summaries; differential privacy only if its threat model and utility budget are designed.                | Measure leakage risk and utility; prohibit embedding raw features in public proof logs.            |

## Visual product guidance

- Use three unmistakable verdicts: PASS, FAIL, INDETERMINATE. Never show “green” for an unavailable verifier dependency.

- Every verdict expands into machine-checkable component checks and the artifact that backs them.

- Link architecture nodes to the trust boundary, owner, API, current health and open threat; make the interactive UI inspectable without external network access.

- Use charts for overhead, proof latency, capture lag and precision/recall only where measured data exists; demo figures must be labelled synthetic.

**35 / OPERATIONS**

# Observability, SLOs, and incident runbooks

*Telemetry should answer “what failed and which evidence is missing?” without exfiltrating row data.*

| **Signal**                | **Initial target to validate**                                                          | **Alert / runbook**                                                                                                             |
|---------------------------|-----------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------|
| Capture lag               | Pilot target: p95 under 5 minutes for bounded pipeline; define by connector.            | Lag rising: check source load, WAL/CDC gap, queue backlog, expired snapshot token; pause releases if completeness is uncertain. |
| Capsule verification      | Local verifier p95 under 2 seconds for ordinary sub-10 MB evidence bundle (hypothesis). | Latency spike: profile hash/serialization; verify no remote fetch hidden in offline profile.                                    |
| Release gate availability | 99.9% monthly target only after baseline and operating-cost review.                     | Dependency outage returns INDETERMINATE, not PASS; queue safe retries; do not silently bypass.                                  |
| Witness health            | High-assurance profile quorum verified before release.                                  | Disagreement: freeze high-risk releases; retain both checkpoints/proofs; investigate split view.                                |
| Key/crypto telemetry      | No unknown algorithms, stale epochs or fallback outside allow-policy.                   | Crypto negotiation mismatch: block affected assurance profile; capture version/config; rotate only after impact analysis.       |
| Privacy leakage           | Zero known raw secret/PII in logs for seeded canaries.                                  | Incident: suspend affected exporter, preserve evidence, rotate exposed credentials, follow customer notification policy.        |

## Required dashboards

- Pipeline status: source → commit → lineage → policy → appraisal → capsule → receipt → release.

- Proof metrics: bundle bytes, Merkle levels, verification duration, failed check counts, witness quorum and split-view findings.

- Queue/connector: CDC lag, retry counts, dead-letter queue age, snapshot expiration, ingestion throughput.

- Crypto inventory: negotiated transport group by peer class, key epoch age, certificate expiry, rotation and revocation events.

- Coherence analytics: alerts by field and source, adjudication age, false-positive rate, root-cause time. No PII in labels.

**36 / QUALITY**

# Test strategy: prove that the deny path works

*The most important security test is a carefully constructed invalid capsule that must never be released.*

| **Test layer**          | **Must include**                                                                                                      | **Acceptance evidence**                                                                       |
|-------------------------|-----------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------|
| Unit / known-answer     | Canonicalization, SHA-384 domain separation, Merkle leaf/internal node, proof encode/decode, nonce state transitions. | Fixed vectors in repository; deterministic results across supported language implementations. |
| Property-based          | Random tree sizes incl. 0/1/odd counts; permutation of row order; duplicate JSON keys; unicode and number edge cases. | Invariants hold for randomized cases; minimized repro committed when failure found.           |
| Integration             | Postgres snapshot, queue, OPA bundle, object store, log/witness mock, verifier CLI.                                   | Capsule made end-to-end from test source; offline verification passes in a clean container.   |
| Fault injection         | Delete parent edge, alter one byte, stale policy, wrong key epoch, replay nonce, stale checkpoint, split witness.     | Correct deterministic FAIL code and no released bytes in every negative case.                 |
| Crypto interoperability | TLS hybrid negotiation, fallback policy, certificate rotation, unsupported peer behavior.                             | Captured negotiated group/library versions; fail-closed where policy says required.           |
| Performance / ANOVA     | Randomized runs across factors; p95/p99; cold/warm cache; control group.                                              | Raw benchmark artifact, environment manifest, repeated runs, confidence intervals.            |
| Security review         | External code review, threat-model review, parser fuzzing, dependency audit, secret scan.                             | No unresolved Critical/High findings before production release; risk accepted by named owner. |

## Release-blocking negative tests

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p>1. Flip one byte of a capsule -&gt; CAPSULE_DIGEST_MISMATCH</p>
<p>2. Remove a required lineage parent -&gt; LINEAGE_CLOSURE_FAILED</p>
<p>3. Reuse a release nonce -&gt; REPLAY_DETECTED</p>
<p>4. Submit stale/changed policy digest -&gt; POLICY_BINDING_FAILED</p>
<p>5. Invalid Merkle inclusion proof -&gt; INCLUSION_PROOF_INVALID</p>
<p>6. Non-append-only checkpoint -&gt; CONSISTENCY_PROOF_INVALID</p>
<p>7. Required attestation absent/stale -&gt; APPRAISAL_REQUIRED_OR_STALE</p>
<p>8. Critical unresolved source mismatch -&gt; COHERENCE_BLOCKED</p>
<p>9. Unsupported canonicalizer/hash profile -&gt; PROFILE_UNSUPPORTED</p>
<p>10. Witness count below profile quorum -&gt; WITNESS_QUORUM_UNMET</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

**37 / DELIVERY ENGINEERING**

# Deployment blueprint: local development to production

*The starter topology is for development only. Production requires private networking, key custody and isolated witnesses.*

## Local dev stack

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p>docker compose: postgres + object-store emulator + opa + api + worker + verifier tests</p>
<p>Profiles: dev (mock attestation and local log only), integration, production-like</p>
<p>Secrets: .env.example contains names only; actual secrets generated on boot or injected</p>
<p>Seed data: synthetic financial/healthcare-like records only, never live customer data</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## Production topology

| **Layer**     | **Deployment decision**                                                                      | **Security configuration**                                                                                            |
|---------------|----------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------|
| Ingress       | Private load balancer; WAF/rate limiting; OIDC or mTLS; request-size cap.                    | No public admin endpoints; strict tenant-level authorization; DDoS quota.                                             |
| API / workers | Separate deployments and service accounts; autoscale stateless paths.                        | Network policies, read-only filesystem where possible, non-root containers, seccomp/AppArmor.                         |
| Metadata DB   | Managed Postgres with private endpoint, PITR, encryption-at-rest.                            | RLS where appropriate; migration role separate from app role; backups encrypted and tested.                           |
| Object store  | Versioned, private bucket/container; retention policy; content-addressed keys.               | Bucket policy prevents public access; KMS key separation; prevent overwrite or use object lock where suitable.        |
| Key service   | Cloud KMS/HSM.                                                                               | Private keys never exported; tightly scoped key permissions; CloudTrail/audit logs; dual control for root operations. |
| Witnesses     | At least one operationally independent witness for pilot; configurable quorum in enterprise. | Different principal/account; pinned checkpoints; gossip/reconciliation and immutable evidence export.                 |
| CI/CD         | SLSA-style build provenance where practical; image digest pinned.                            | Signed build artifacts, SBOM, vulnerability gates, reviewed Terraform, environment promotion separation.              |

## Promotion gates

- Dev → test: schema migration tests and deterministic test vectors pass.

- Test → staging: integration + fault injection + privacy scan + crypto interop passes.

- Staging → pilot: threat model reviewed, rollback/recovery tested, one independent verifier run.

- Pilot → production: external security review, incident tabletop, customer data retention contract, documented residual risks.

**38 / IMPLEMENTATION BACKLOG**

# Repository layout and engineering ownership

*Organize the system so core verification can be reviewed independently of web/API code.*

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p>seamdb/</p>
<p>api/ # REST handlers + generated OpenAPI types</p>
<p>cmd/verifier/ # offline CLI entrypoint</p>
<p>internal/canonical/ # versioned canonicalization + known-answer vectors</p>
<p>internal/commitment/ # Merkle profile + proof verification</p>
<p>internal/capsule/ # schema, state machine, digest calculation</p>
<p>internal/policy/ # OPA input generation + decision binding</p>
<p>internal/lineage/ # DAG closure + cycle checks</p>
<p>internal/receipts/ # log adapter + consistency/witness validation</p>
<p>connectors/postgres/ # read-only snapshot and capture</p>
<p>connectors/iceberg/ # metadata/snapshot binding</p>
<p>schemas/ # JSON Schema / protobuf / OpenAPI</p>
<p>migrations/ # versioned SQL migrations</p>
<p>policies/ # reviewed Rego bundles</p>
<p>deploy/ # Helm/Terraform/Compose</p>
<p>tests/vectors/ # canonical input and proof vectors</p>
<p>tests/faults/ # negative capsule fixtures</p>
<p>docs/security/ # threat model, key ceremony, profile catalog</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

| **Owner role**           | **Owns**                                                       | **Must not unilaterally control**                                      |
|--------------------------|----------------------------------------------------------------|------------------------------------------------------------------------|
| Crypto/verification lead | Capsule bytes, hash/Merkle libraries, verifier and vectors.    | Production key custody or source data truth claims.                    |
| Platform lead            | API, queues, deployment, SLOs, recovery.                       | Alone approving an emergency security bypass.                          |
| Data integration lead    | Connectors, schema mappings, snapshot contracts.               | Declaring unsupported sources “atomic” without evidence.               |
| Security lead            | Threat model, keys, policy profile, incident runbooks.         | Self-approving unresolved critical findings without accountable owner. |
| Product / customer lead  | Pilot success metric, workflow integration, pricing discovery. | Converting experimental module scores into compliance promises.        |

## PR merge checklist

- New serialized field has a versioning decision and canonicalization test.

- Any new “PASS” check has an adversarial negative test and explicit assumption.

- Logs/metrics are reviewed for row values, secrets and high-cardinality labels.

- API and verifier behavior are tested from a clean checkout.

- Threat model, runbook and customer-facing assurance profile are updated when semantics change.

**39 / EXECUTION**

# 12-week build backlog with acceptance criteria

*Every sprint ends with a demonstrable artifact, not a slide saying “secure by design”.*

| **Sprint**                | **Implementation tasks**                                                                                          | **Exit criteria**                                                                                          |
|---------------------------|-------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------|
| S1: scope + data contract | Select one customer pipeline; map source/owner/destination; write capsule schema, threat model and proof catalog. | Signed design-partner scope; exact release workflow; baseline audit time; top 10 abuse cases.              |
| S2: capture adapter       | Read-only Postgres capture; schema digest; repeatable snapshot token; row count and stable canonical row stream.  | Same immutable snapshot creates same root across reruns; failure on snapshot expiry or row-count mismatch. |
| S3: commitment/verifier   | Merkle library; capsule digest; offline CLI; JSON output and exit codes.                                          | Known-answer vectors; tampered artifact fails; verifier works without API access.                          |
| S4: lineage/policy        | OpenLineage event ingest; DAG closure; OPA bundle digest; decision binding.                                       | Missing parent and stale policy are fail-closed; event duplicates idempotent.                              |
| S5: receipts/release gate | Append-only log adapter; receipt and consistency proofs; one-use release grant.                                   | Release blocked until required receipt; replay test fails; external checkpoint copy available.             |
| S6: pilot hardening       | Second view consistency, PQ TLS interoperability test, observability, report export, tabletop.                    | Customer validates dossier; overhead measured; critical negative tests pass; renewal decision made.        |

## Definition of done for the MVP

- Offline verifier reproduces PASS/FAIL from exported bundle plus pinned trust roots.

- One postgresql-backed pipeline can produce source snapshot → transformation → governed export capsule.

- Evidence explains data roots, lineage, policy, result root, receipt, crypto profile and all unsupported claims.

- At least 10 seeded attacks are blocked; no negative test silently degrades to PASS.

- One paying design partner has a named audit/data-sharing use case, acceptance criterion and next-step contract.

**40 / RELEASE READINESS**

# Go-live gates, RACI, and residual-risk register

*Launch only when evidence coverage, operational response and business demand are independently visible.*

| **Risk**                                                      | **Severity before mitigation** | **Mitigation / owner**                                                                                         | **Go-live gate**                                                                          |
|---------------------------------------------------------------|--------------------------------|----------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------|
| Classical signature can be forged by future quantum adversary | High / long horizon            | Security lead: clearly bound checkpoint signature lifetime; external witness copies; algorithm migration plan. | All user-facing docs state ML-KEM protects key establishment only; no PQ signature claim. |
| Source lies before first capture                              | High                           | Data lead: authoritative source provenance, dual-source reconciliation, signed source manifest where possible. | Guarantee catalog states capture point and source-truth assumptions.                      |
| Canonicalization mismatch causes invalid roots                | High                           | Verification lead: deterministic schema profiles, multi-language vectors, reject unsupported types.            | Cross-implementation vector suite passes.                                                 |
| Log operator equivocates                                      | High                           | Security/platform: independent witnesses, checkpoint gossip, out-of-band receipt exports.                      | Split-view tabletop and alert validated.                                                  |
| TEE evidence interpreted as “secure code” proof               | Medium/High                    | Security lead: RATS appraisal policy and narrow claims; assess side-channel/patch limits.                      | Appraisal output uses measured-claims language, not absence-of-bugs language.             |
| Sheaf/MDL false positives or research drift                   | Medium                         | Research lead: baselines, labelled corpus, human adjudication, no release override.                            | Only enabled as advisory until validated on customer data.                                |
| Pilot has no budget owner / weak ROI                          | High business                  | Product: paid pilot, named buyer, audit time baseline and renewal criterion.                                   | No open-ended free pilot; commercial gate by week 12.                                     |

## RACI for a high-risk release

| **Action**                          | **Data owner** | **SEAMDB operator** | **Security approver** | **Auditor/partner** |
|-------------------------------------|----------------|---------------------|-----------------------|---------------------|
| Declare source and purpose          | A/R            | C                   | C                     | I                   |
| Publish capsule and receipt         | C              | A/R                 | C                     | I                   |
| Approve exceptional policy          | C              | C                   | A/R                   | I                   |
| Verify and accept evidence          | C              | C                   | C                     | A/R                 |
| Investigate split-view or tampering | R              | R                   | A                     | C                   |

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>LAUNCH CRITERION</strong></p>
<p>Any unowned critical risk, undocumented fallback, failing verifier test, or unsupported proof claim blocks launch. “We passed the demo” is not a security gate.</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

**APPENDIX C / SOURCE TRACEABILITY**

# Research-to-engineering traceability and references

*The five provided manuscripts are inputs to the design vocabulary; standards literature supports protocol choices. None individually validates SEAMDB.*

| **User-supplied manuscript**                                                       | **Specific source-derived method / framing**                                                                                                                | **SEAMDB design hypothesis (not a theorem transfer)**                                                                                                              |
|------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| A finite Smith–Toda complex V(4) at the prime 1009                                 | Filtered obstruction enumeration; persistence is established only after possible differential targets are eliminated; final obstruction handled separately. | Model verification as named proof obligations and explicit failure targets. A commitment passing one check is not enough to establish the whole assurance profile. |
| A zero-entropy system without a smooth positive-volume model                       | Quantitative switch construction; local/future/past constraints; global realizability may fail despite coarse invariants.                                   | Compare local source views and end-to-end lineage. A source-level hash or smooth-looking dashboard cannot imply globally coherent provenance.                      |
| Abelian covers, Gale correspondences, and the Hodge conjecture for powers          | Explicit correspondences transfer information under preconditions; genericity loci are part of the statement.                                               | Adapters and transformation mappings must declare validity domains; proof metadata must retain map/version digests and preconditions.                              |
| A Counterexample to Kaplansky’s Direct-Finiteness Conjecture in Odd Characteristic | Asymmetric one-sided inverse; distinct left/right behavior; rank and factorization constraints require exact construction.                                  | Model release validation as both positive and negative checks; never infer reversibility, completeness, or absence of defects from a one-directional check.        |
| A counterexample to the nearby Lagrangian conjecture                               | Coarse topology/projection conditions do not determine finer ambient isotopy class; a finer obstruction distinguishes examples.                             | Schema compatibility and data-root equality do not prove semantic correctness. Retain fine-grained transform, policy, and runtime evidence.                        |

## External standards / technical references

R1. NIST FIPS 203, Module-Lattice-Based Key-Encapsulation Mechanism (ML-KEM), 2024. [https://csrc.nist.gov/pubs/fips/203/final](https://csrc.nist.gov/pubs/fips/203/final)

R2. NIST FIPS 204 describes ML-DSA signatures. Listed here to distinguish the standard from this design: SEAMDB v1 does not adopt ML-DSA or any post-quantum signature. [https://csrc.nist.gov/pubs/fips/204/final](https://csrc.nist.gov/pubs/fips/204/final)

R3. Sigstore Rekor specification: transparency log and Merkle inclusion/consistency proof concepts. [https://github.com/sigstore/architecture-docs/blob/main/rekor-spec.md](https://github.com/sigstore/architecture-docs/blob/main/rekor-spec.md)

R4. RFC 9334, Remote ATtestation procedureS (RATS) Architecture. [https://www.rfc-editor.org/rfc/rfc9334](https://www.rfc-editor.org/rfc/rfc9334)

R5. OpenLineage project documentation for cross-system job/run/dataset lineage event model. [https://openlineage.io/](https://openlineage.io/)

R6. PostgreSQL row security policies; treat as one layer of source authorization. [https://www.postgresql.org/docs/current/ddl-rowsecurity.html](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)

R7. OpenTelemetry database semantic conventions, including query-text sanitization guidance. [https://opentelemetry.io/docs/specs/semconv/db/database-spans/](https://opentelemetry.io/docs/specs/semconv/db/database-spans/)

R8. SPIFFE Workload API for portable workload identity. [https://spiffe.io/docs/latest/spiffe-specs/spiffe_workload_api/](https://spiffe.io/docs/latest/spiffe-specs/spiffe_workload_api/)

R9. Apache Iceberg REST Catalog and snapshot/metadata interoperability references. [https://iceberg.apache.org/rest-catalog-spec/](https://iceberg.apache.org/rest-catalog-spec/)

R10. IETF/SCITT architecture materials should be pinned to the exact draft/version used during implementation; do not claim SEAMDB is SCITT-conformant without a conformance review. [https://datatracker.ietf.org/wg/scitt/about/](https://datatracker.ietf.org/wg/scitt/about/)

*Research integrity note: externally sourced protocol choices are current as of 14 October 2026 and should be rechecked at design freeze. The uploaded manuscripts are cited by title as user-supplied material; no claim is made here that their unusual mathematical theorems are established cryptographic results.*
