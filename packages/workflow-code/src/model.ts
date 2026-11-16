/**
 * The Canonical Workflow Model (CWM): a projection of a stored workflow graph with no ids and no
 * layout, keyed by normalized block name. The DB graph stays authoritative; the CWM is computed on
 * read (`canonicalize`) and written back through `materialize`, which keeps prev's raw bytes for
 * every param whose canonical form is unchanged (build-spec decision 1, s1 D1).
 *
 * Ids live in the lock (`lock.ts`), never here. Two CWMs are equal when `canonicalEquals` says so;
 * `annotations` never take part in equality, hashing or the source fingerprint.
 */

import type { PortableResourceKind } from '@sim/workflow-types/resources'
import type { BlockRetryConfig, Variable } from '@sim/workflow-types/workflow'

/**
 * A block's identity inside one workflow: `normalizeWorkflowBlockName(name)` (lowercased,
 * whitespace and dots stripped; packages/workflow-types/src/workflow.ts:662). References resolve
 * only by this form (executor/variables/resolvers/block.ts:46-61, 388-390), so it is unique per
 * workflow. A legacy normalized-name collision is projected as `${key}~${n}` for the losing block,
 * with the smallest n ≥ 2 that no other key uses, and `E_CANON_LEGACY_NAME_COLLISION`
 * (s1 §2 canonicalize step 1). Such a workflow cannot round-trip until the block is renamed.
 */
export type BlockKey = string

/**
 * A condition or router branch name, unique per block and a valid JS identifier. Defaults mirror
 * the copilot handles: condition `if`, `elseIf0..n`, `else`; router `route0..n`
 * (build-spec decision 5, s1 quirk 8, validation.ts:1100-1130).
 */
export type BranchKey = string

/** `normalizeWorkflowBlockName(variable.name)`; unique per workflow. */
export type VarKey = string

/** A subBlock id as stored in `block.subBlocks` (registry `SubBlockConfig.id`). */
export type SubBlockId = string

/** A canonical basic/advanced group id (registry `canonicalParamId`). */
export type CanonicalParamId = string

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

/** Which member of a basic/advanced pair is effective. */
export type ParamMode = 'basic' | 'advanced'

/**
 * Kinds of workspace resource a value can point at by internal id: the shared portable vocabulary
 * (`WORKFLOW_RESOURCE_KINDS` in `@sim/workflow-types/resources`, also used by workflow imports and
 * fork sync) minus `env-var`. Environment variables are `{{NAME}}` text tokens printed as
 * `env.NAME`, never nodes. Each kind is printed call-form (`table('leads')`,
 * `binding('support-slack')`, `kb('docs')`, ...; build-spec decision 7, s2 D6) and resolved by the
 * server's `ResourceKeyResolver`.
 */
export type ResourceKind = Exclude<PortableResourceKind, 'env-var'>

/** A workflow variable referenced by internal id (variables-input `variableId`). */
export interface VarNode {
  $sim: 'var'
  key: VarKey
}

/**
 * A workspace resource lifted from its internal id to its stable key. Where an id sits inside a
 * larger stored shape, only the id is replaced and the shape is kept:
 * - scalar or array encoding: the string, or each array element, becomes a node;
 * - `files` encoding (file-upload objects carrying `key`): each object stays an object and its
 *   `key` field becomes `{ $sim: 'resource', kind: 'file', key }`;
 * - `csv` encoding (several ids in one comma-joined string): see {@link CsvNode}.
 */
export interface ResourceNode {
  $sim: 'resource'
  kind: ResourceKind
  key: string
}

/**
 * An internal id the resolver could not map to a key (deleted resource, foreign workspace, or a
 * kind this version does not know). Kept verbatim so materialize writes the same bytes back;
 * canonicalize emits `W_CANON_UNRESOLVED_ID`. `kind` is any resolver kind or `var`.
 */
export interface UnresolvedNode {
  $sim: 'unresolved'
  kind: string
  id: string
}

/**
 * A stored string holding several ids joined by commas (the reference manifest's `csv` encoding,
 * lib/workflows/references/manifest.ts:96 and import-plan.ts:73). Materialize joins the items with
 * `,`; prev's raw string (including any spaces after commas) is kept when the items are equal.
 */
export interface CsvNode {
  $sim: 'csv'
  items: Array<ResourceNode | UnresolvedNode>
}

/**
 * Escape for a stored object that itself carries a `$sim` key, so the encoding stays a bijection:
 * canonicalize wraps such an object as `{ $sim: 'literal', value }` and materialize unwraps it.
 */
export interface LiteralNode {
  $sim: 'literal'
  value: Json
}

/** Internal-id sites inside values, lifted to keys (s1 §2, sites per remap-internal-ids.ts:111-127). */
export type SimNode = VarNode | ResourceNode | UnresolvedNode | CsvNode | LiteralNode

/**
 * A param value. Strings are stored text, verbatim: references stay as `<block.path>`,
 * `{{ENV}}` and `<variable.key>` tokens (build-spec decision 8). Canonicalize rewrites only ref
 * prefixes to normalized form and `<variable.<id>>` to `<variable.<key>>` (s3 §2 requirements a, b).
 */
export type Value = Json | SimNode | Value[] | { [key: string]: Value }

/**
 * One stored subBlock value, decoded. The CWM is encoding-free: whether the subBlock held native
 * JSON or JSON text (structured types: tools, tableRows, inputFormat, tag filters; s1 quirk 9) is
 * not recorded, so `canonicalEquals`, hashes, diffs and the fingerprint never see it. Materialize
 * picks the encoding: prev's raw encoding when the subBlock exists in prev, else the catalog
 * `CatalogSubBlock.storage`; and it keeps prev's raw bytes when the decoded value is unchanged
 * (s1 D1).
 *
 * A subBlock whose stored value is `null` is absent from `CanonicalBlock.params`
 * (s3 §2 requirement d); `''` is kept and never coerced to `null` (s1 quirk 25,
 * serializer/index.ts:620-634).
 */
export type CanonicalParam =
  | { kind: 'value'; value: Value }
  | { kind: 'tools'; tools: CanonicalTool[] }

/** One entry of a `tool-input` list (s1 §2, canonicalize step 5). */
export interface CanonicalTool {
  type: string
  operation?: string
  toolId?: string
  title?: string
  /** Decoded via `decodeToolParamValue`; `''` kept (tools/param-shape.ts:185-214). */
  params: Record<string, Value>
  /**
   * Effective modes per canonical group of this tool, lifted from index keys `${i}:cid` and legacy
   * `${type}:cid` (visibility.ts:372-512, s1 quirk 3); re-indexed by position on write.
   */
  modes: Record<CanonicalParamId, ParamMode>
  usageControl?: 'auto' | 'force' | 'none'
  usageControlExpression?: string
  /** The DB copy wins over the snapshot at run time (agent/handler.ts:1098-1115, s1 quirk 17). */
  customTool?: {
    ref?: ResourceNode | UnresolvedNode
    snapshot?: { schema: Json; code: string }
  }
  operationPolicy?: Json
  /** Unknown stored keys, minus the UI-only `isExpanded`. */
  extra?: Record<string, Json>
}

/** Condition or router rows, lifted out of the `conditions` / `routes` subBlock. */
export interface CanonicalBranches {
  kind: 'condition' | 'router'
  /**
   * `null` when the subBlock was never persisted: the canvas writes it only on first edit
   * (condition-input.tsx:384-392) and edges may point at the implicit `${id}-if` handle
   * (s1 quirk 7). Materialize keeps `null`. The source form of `null` is an empty branch object
   * (`condition('Name', {})`, router `routes: {}`); the implicit default keys (`if` and `else`
   * for a condition, `route0` for a router) stay addressable as ports. A non-empty object is
   * always a persisted list, so `[]` is never produced.
   */
  rows: CanonicalBranchRow[] | null
}

export interface CanonicalBranchRow {
  key: BranchKey
  /** The condition expression (condition) or route description (router), verbatim. */
  value: string
  /**
   * Set only when the stored title differs from the positional one. The executor finds `else` by
   * stored title (condition/handler.ts:474) while the UI shows positional titles
   * (condition-input.tsx:395-401), s1 quirk 4.
   */
  titleOverride?: string
  /**
   * Set when the stored row has no title at all (rows written by the edit engine or copilot can
   * omit it). Distinct from a positional title: a last row without a title is not found as `else`
   * by the executor (condition/handler.ts:474), so materialize writes no title for such a row.
   * Never set together with `titleOverride`.
   */
  titleMissing?: true
  /** Unknown non-UI keys. UI state (`showTags`, `searchTerm`, ...) is stripped (s1 quirk 6). */
  extra?: Record<string, Json>
}

/**
 * Loop config as the `loops` map stores it (`Loop`, workflow.ts:732-742). Optional fields are
 * absent exactly when storage omits them; canonicalize never fills defaults, so materialize can
 * write prev's config back verbatim when canonical-equal.
 */
export interface LoopSpec {
  kind: 'loop'
  loopType: 'for' | 'forEach' | 'while' | 'doWhile'
  /**
   * The count that runs: `block.data.count` raw (`0` kept with `W_CANON_SUBFLOW_REPAIRED`; the
   * runtime reads `count || 5`), or 5 when `data` has none (s1 quirk 19, load.ts:186-245).
   */
  iterations: number
  forEachItems?: Json
  whileCondition?: string
  doWhileCondition?: string
}

/** Parallel config as the `parallels` map stores it (`Parallel`, workflow.ts:744-753). */
export interface ParallelSpec {
  kind: 'parallel'
  /** Absent in storage means the loader's fallback applies, which differs by path (s1 quirk 19). */
  parallelType?: 'count' | 'collection'
  count?: number
  distribution?: Json
  /** Raw stored value; the runtime clamps to 1–20 (subflow-helpers.ts:8-14). */
  batchSize?: number
}

export interface CanonicalBlock {
  key: BlockKey
  /** Display name exactly as stored; `key` is derived from it. */
  name: string
  /** Registry type, including legacy versions and per-org `custom_block_<slug>` (s1 quirks 16, 18). */
  type: string
  /** The enclosing loop/parallel (`data.parentId`), or `null` at the root. */
  parent: BlockKey | null
  enabled: boolean
  /** Protected: apply refuses any diff touching it (build-spec decision 11, s4 D2). */
  locked: boolean
  /** The stored `triggerMode` flag. */
  triggerMode: boolean
  /**
   * The stored legacy flag. Semantic, not cosmetic: when on, a standalone advanced field is
   * serialized and pairs default to advanced (serializer/index.ts:100-105, 641-650).
   */
  advancedMode: boolean
  /**
   * Effective error port: `errorEnabled || has an error edge` (`resolveEffectiveErrorEnabled`,
   * workflow.ts:505). Never the raw flag alone.
   */
  errorPort: boolean
  /** Raw stored retry policy; numbers are kept when `enabled` is false (workflow.ts:87-101). */
  retry: BlockRetryConfig | null
  /**
   * Every stored subBlock, keyed by subBlock id, except synthetic tool mirrors, server-owned
   * runtime ids (`webhookId`, `triggerPath`, `triggerConfig`, `triggerId`; s1 D6), parked
   * `_removed_` keys, and `conditions`/`routes` (lifted into `branches`). Stale hidden values are
   * kept and listed in `annotations.inactive` (build-spec decision 2, s1 D3).
   */
  params: Record<SubBlockId, CanonicalParam>
  /**
   * Effective mode for every canonical pair on this block, explicit or inferred (s1 canonicalize
   * step 4). The printer elides modes derivable from the value kind (build-spec decision 7).
   */
  modes: Record<CanonicalParamId, ParamMode>
  /** Present only on condition and router blocks. */
  branches?: CanonicalBranches
  /** Present only on loop and parallel containers. */
  subflow?: LoopSpec | ParallelSpec
  /**
   * Unknown `block.data` keys, verbatim. Source carries only a container's subflow keys, which the
   * serializer passes on (`meta.extraData`); apply keeps the rest from the stored workflow.
   */
  extra?: Record<string, Json>
}

/**
 * The port an edge leaves from.
 * - `out`: the default `source` handle.
 * - `error`: the `error` handle.
 * - `branch`: `condition-<rowId>` / `router-<rowId>`, keyed by branch key.
 * - `subflowStart`: `${kind}-start-source` on a container, into its first child (workflow.ts:427).
 * - `subflowEnd`: `${kind}-end-source` on a container, after the container finishes.
 * - `raw`: an unknown or legacy handle, kept verbatim and printed `edge(a, 'raw', b)`.
 */
export type Port =
  | { kind: 'out' }
  | { kind: 'error' }
  | { kind: 'branch'; key: BranchKey }
  | { kind: 'subflowStart' }
  | { kind: 'subflowEnd' }
  | { kind: 'raw'; handle: string }

/**
 * A port's string form, used for sorting edges and in `edges:` comment anchors:
 * `out`, `error`, `branch:<key>`, `subflowStart`, `subflowEnd`, `raw:<handle>`.
 */
export type PortKey =
  | 'out'
  | 'error'
  | `branch:${BranchKey}`
  | 'subflowStart'
  | 'subflowEnd'
  | `raw:${string}`

/**
 * An edge, identified by its `(from, port, to)` tuple. Edge ids are not in the CWM or the lock;
 * the server reuses prev's edge id when the tuple matches (build-spec decision 3, s1 D5).
 */
export interface CanonicalEdge {
  from: BlockKey
  port: Port
  to: BlockKey
}

export interface CanonicalVariable {
  key: VarKey
  name: string
  type: Variable['type']
  value: Json
}

/** Workflow-level fields printed in the `workflow(name, { description })` header. */
export interface CanonicalWorkflowMeta {
  name: string
  description: string | null
}

/**
 * Where a comment attaches in a printed file (s3 §2, build-spec decision 10):
 * - `header`: above the imports; `wiring`: above the first wiring statement; `footer`: file end.
 * - `block`: the block's `const` declaration.
 * - `param`: one param property in the block call. `param` is the printed param name: the
 *   `canonicalParamId` for a basic/advanced pair, else the subBlock id.
 *   An entry under the block's `meta.extra` takes the `param` anchor of its key.
 * - `edges`: the wiring statement for that (source, port).
 * - `var`: one variable declaration in the `workflow(...)` header.
 */
export type Anchor =
  | { kind: 'header' }
  | { kind: 'wiring' }
  | { kind: 'footer' }
  | { kind: 'block'; block: BlockKey }
  | { kind: 'param'; block: BlockKey; param: SubBlockId | CanonicalParamId }
  | { kind: 'edges'; block: BlockKey; port: PortKey }
  | { kind: 'var'; variable: VarKey }

/**
 * An {@link Anchor} serialized for use as a map key (`encodeAnchor` / `decodeAnchor` in
 * `anchors.ts`). Branded so a raw string cannot stand in for one.
 */
export type AnchorKey = string & { readonly __anchorKey: true }

export interface CodeComment {
  /** Comment text without the `//` or `/* *\/` delimiters, verbatim. */
  text: string
  kind: 'line' | 'block'
  placement: 'leading' | 'trailing'
}

/**
 * Non-semantic facts carried beside the graph. Excluded from `canonicalEquals`,
 * `canonicalHash`, `diffCanonical` and `sourceFingerprint`.
 */
export interface WorkflowAnnotations {
  /**
   * Per block, the param ids whose value is stored but not serialized under the current values
   * and not read by deploy (`canonicalize/activity.ts`; opaque catalog conditions count as
   * active unless expanded per operation). Source leaves them out and apply restores them from the
   * stored workflow (DESIGN.md A18), so only canonicalize fills this; a compiled workflow has none.
   */
  inactive: Record<BlockKey, SubBlockId[]>
  /**
   * Comments by anchor, in source order. Persisted server-side in `workflow.code_meta` once it
   * exists (build-spec decision 6); until then only files carry them.
   */
  comments: Partial<Record<AnchorKey, CodeComment[]>>
}

export interface CanonicalWorkflow {
  modelVersion: 1
  meta: CanonicalWorkflowMeta
  blocks: Record<BlockKey, CanonicalBlock>
  /** Sorted by `(from, portKey(port), to)` with `compareStrings`; no duplicate tuples. */
  edges: CanonicalEdge[]
  variables: Record<VarKey, CanonicalVariable>
  annotations: WorkflowAnnotations
}
