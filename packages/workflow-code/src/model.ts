/**
 * The Canonical Workflow Model (CWM): a projection of a stored workflow graph with no ids and no
 * layout, keyed by normalized block name. The DB graph stays authoritative; the CWM is computed on
 * read (`canonicalize`) and written back through `materialize`, which keeps prev's raw bytes for
 * every param whose canonical form is unchanged.
 *
 * Ids live in the lock (`lock.ts`), never here. Two CWMs are equal when `canonicalEquals` says so;
 * `annotations` never take part in equality, hashing or the source fingerprint.
 */

import { isRecordLike } from '@sim/utils/object'
import type { PortableResourceKind } from '@sim/workflow-types/resources'
import type { BlockRetryConfig, Variable } from '@sim/workflow-types/workflow'

/**
 * A block's identity inside one workflow: `normalizeWorkflowBlockName(name)` (lowercased,
 * whitespace and dots stripped; packages/workflow-types/src/workflow.ts). References resolve
 * only by this form (`BlockResolver`), so it is unique per
 * workflow. A legacy normalized-name collision is projected as `${key}~${n}` for the losing block,
 * with the smallest n ≥ 2 that no other key uses, and `E_CANON_LEGACY_NAME_COLLISION`.
 * Such a workflow cannot round-trip until the block is renamed.
 */
export type BlockKey = string

/**
 * A condition or router branch name, unique per block and a valid JS identifier. Defaults mirror
 * the copilot handles: condition `if`, `elseIf0..n`, `else`; router `route0..n`
 * (`validateConditionHandle`, lib/workflows/editing/validation.ts).
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
 * `credential('support-slack')`, `knowledgeBase('docs')`, ...) and resolved by the
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
 * Maps workspace resources between internal ids and stable keys. Implemented server-side over the
 * workspace's tables, knowledge bases, credentials (idents) and so on; `null` when there is no
 * mapping.
 */
export interface ResourceKeyResolver {
  toKey(kind: ResourceKind, id: string): string | null
  toId(kind: ResourceKind, key: string): string | null
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
 * `buildWorkflowReferenceManifest` and `encodeIdentifiers`). Materialize joins the items with
 * `,`; prev's raw string (including any spaces after commas) is kept when the items are equal.
 */
interface CsvNode {
  $sim: 'csv'
  items: Array<ResourceNode | UnresolvedNode>
}

/**
 * Escape for a stored object that itself carries a `$sim` key, so the encoding stays a bijection:
 * canonicalize wraps such an object as `{ $sim: 'literal', value }` and materialize unwraps it.
 */
interface LiteralNode {
  $sim: 'literal'
  value: Json
}

/** Internal-id sites inside values, lifted to keys (sites per `remapVariableIdsInSubBlocks`). */
export type SimNode = VarNode | ResourceNode | UnresolvedNode | CsvNode | LiteralNode

/**
 * A param value. Strings are stored text, verbatim: references stay as `<block.path>`,
 * `{{ENV}}` and `<variable.key>` tokens. Canonicalize rewrites only ref
 * prefixes to normalized form and `<variable.<id>>` to `<variable.<key>>`.
 */
export type Value = Json | SimNode | Value[] | { [key: string]: Value }

const SIM_NODE_KINDS: Record<SimNode['$sim'], true> = {
  var: true,
  resource: true,
  unresolved: true,
  csv: true,
  literal: true,
}

/** Whether a value is one of the {@link SimNode} kinds. */
export function isSimNode(value: unknown): value is SimNode {
  return (
    isRecordLike(value) &&
    typeof value.$sim === 'string' &&
    Object.hasOwn(SIM_NODE_KINDS, value.$sim)
  )
}

/** Whether a value is an object literal: a record with no `$sim` key. */
export function isPlainRecord(value: Value): value is { [key: string]: Value } {
  return isRecordLike(value) && !('$sim' in value)
}

/**
 * One stored subBlock value, decoded. The CWM is encoding-free: whether the subBlock held native
 * JSON or JSON text (structured types: tools, tableRows, inputFormat, tag filters) is
 * not recorded, so `canonicalEquals`, hashes, diffs and the fingerprint never see it. Materialize
 * picks the encoding: prev's raw encoding when the subBlock exists in prev, else the catalog
 * `CatalogSubBlock.storage`; and it keeps prev's raw bytes when the decoded value is unchanged.
 *
 * A subBlock whose stored value is `null` is absent from `CanonicalBlock.params`;
 * `''` is kept and never coerced to `null` (`extractBlockParams`).
 */
export type CanonicalParam =
  | { kind: 'value'; value: Value }
  | { kind: 'tools'; tools: CanonicalTool[] }

/** One entry of a `tool-input` list. */
export interface CanonicalTool {
  type: string
  operation?: string
  toolId?: string
  title?: string
  /** Decoded via `decodeToolParamValue`; `''` kept. */
  params: Record<string, Value>
  /**
   * Effective modes per canonical group of this tool, lifted from index keys `${i}:cid` and legacy
   * `${type}:cid`; re-indexed by position on write.
   */
  modes: Record<CanonicalParamId, ParamMode>
  usageControl?: 'auto' | 'force' | 'none'
  usageControlExpression?: string
  /** The DB copy wins over the snapshot at run time (`fetchCustomToolById` in the agent handler). */
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
   * (condition-input.tsx) and edges may point at the implicit `${id}-if` handle.
   * Materialize keeps `null`. The source form of `null` is an empty branch object
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
   * stored title (`isElseConditionTitle`) while the UI shows positional titles
   * (condition-input.tsx).
   */
  titleOverride?: string
  /**
   * Set when the stored row has no title at all (rows written by the edit engine or copilot can
   * omit it). Distinct from a positional title: a last row without a title is not found as `else`
   * by the executor (`isElseConditionTitle`), so materialize writes no title for such a row.
   * Never set together with `titleOverride`.
   */
  titleMissing?: true
  /** Unknown non-UI keys. UI state (`showTags`, `searchTerm`, ...) is stripped. */
  extra?: Record<string, Json>
}

/**
 * Loop config as the `loops` map stores it (`Loop`). Optional fields are
 * absent exactly when storage omits them; canonicalize never fills defaults, so materialize can
 * write prev's config back verbatim when canonical-equal.
 */
export interface LoopSpec {
  kind: 'loop'
  loopType: 'for' | 'forEach' | 'while' | 'doWhile'
  /**
   * The count that runs: `block.data.count` raw (`0` kept with `W_CANON_SUBFLOW_REPAIRED`; the
   * runtime reads `count || 5`), or 5 when `data` has none (`loadWorkflowFromNormalizedTablesRaw`).
   */
  iterations: number
  forEachItems?: Json
  whileCondition?: string
  doWhileCondition?: string
}

/** Parallel config as the `parallels` map stores it (`Parallel`). */
export interface ParallelSpec {
  kind: 'parallel'
  /** Absent in storage means the loader's fallback applies, which differs by path. */
  parallelType?: 'count' | 'collection'
  count?: number
  distribution?: Json
  /** Raw stored value; the runtime clamps to 1–20 (`clampParallelBatchSize`). */
  batchSize?: number
}

export interface CanonicalBlock {
  key: BlockKey
  /** Display name exactly as stored; `key` is derived from it. */
  name: string
  /** Registry type, including legacy versions and per-org `custom_block_<slug>`. */
  type: string
  /** The enclosing loop/parallel (`data.parentId`), or `null` at the root. */
  parent: BlockKey | null
  enabled: boolean
  /** Locked: apply refuses any diff touching it. */
  locked: boolean
  /** The stored `triggerMode` flag. */
  triggerMode: boolean
  /**
   * The stored legacy flag. Semantic, not cosmetic: when on, a standalone advanced field is
   * serialized and pairs default to advanced (`shouldSerializeSubBlock`, `extractBlockParams`).
   */
  advancedMode: boolean
  /**
   * Effective error port: `errorEnabled || has an error edge` (`resolveEffectiveErrorEnabled`,
   * workflow.ts). Never the raw flag alone.
   */
  errorPort: boolean
  /** Raw stored retry policy; numbers are kept when `enabled` is false (`BlockRetryConfig`). */
  retry: BlockRetryConfig | null
  /**
   * Every stored subBlock, keyed by subBlock id, except synthetic tool mirrors, server-owned
   * runtime ids (`webhookId`, `triggerPath`, `triggerConfig`, `triggerId`), parked
   * `_removed_` keys, and `conditions`/`routes` (lifted into `branches`). Stale hidden values are
   * kept (`executableInactiveParams` names them).
   */
  params: Record<SubBlockId, CanonicalParam>
  /**
   * Effective mode for every canonical pair on this block, explicit or inferred. Source never
   * writes a mode: the value kind picks the member (DESIGN.md "Print").
   */
  modes: Record<CanonicalParamId, ParamMode>
  /** Present only on condition and router blocks. */
  branches?: CanonicalBranches
  /** Present only on loop and parallel containers. */
  subflow?: LoopSpec | ParallelSpec
  /**
   * Unknown `block.data` keys, verbatim. Source carries only a container's subflow keys, which the
   * serializer passes on (`meta.subflowData`); apply keeps the rest from the stored workflow.
   */
  extra?: Record<string, Json>
}

/**
 * The port an edge leaves from.
 * - `out`: the default `source` handle.
 * - `error`: the `error` handle.
 * - `branch`: `condition-<rowId>` / `router-<rowId>`, keyed by branch key.
 * - `subflowStart`: `${kind}-start-source` on a container, into its first child.
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
 * the server reuses prev's edge id when the tuple matches.
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
 * Where a comment attaches in a printed file:
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
interface WorkflowAnnotations {
  /**
   * Comments by anchor, in source order. Stored server-side in `workflow_source_meta`.
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
