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
import {
  type PortableResourceKind,
  WORKFLOW_RESOURCE_KINDS,
  type WorkflowResourceKind,
} from '@sim/workflow-types/resources'
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

/** A JSON value: what the CWM stores wherever no canonical node can appear. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

/** Whether a JSON value is an object (not an array or `null`), its members still typed `Json`. */
export function isJsonObject(value: Json | undefined): value is { [key: string]: Json } {
  return isRecordLike(value)
}

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

/** Every {@link ResourceKind}, derived from the shared vocabulary so it cannot drift from it. */
const RESOURCE_KINDS: readonly ResourceKind[] = [
  ...WORKFLOW_RESOURCE_KINDS.filter(
    (kind): kind is Exclude<WorkflowResourceKind, 'env-var'> => kind !== 'env-var'
  ),
  'workflow',
]

/** Whether a value names a {@link ResourceKind}. */
export function isResourceKind(value: unknown): value is ResourceKind {
  return typeof value === 'string' && RESOURCE_KINDS.some((kind) => kind === value)
}

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
 * - `skills` encoding (agent `skill-input` entries `{ skillId, name }`): an entry whose skill
 *   resolves becomes the `skill` node itself, so it prints `skill('key')` as the SDK types it.
 *   `name` is display text the agent handler never reads; materialize writes it back from prev's
 *   entry for the same skill, else {@link ResourceKeyResolver.nameOf}. Any other entry (an
 *   unresolved skill, a builtin one ({@link ResourceKeyResolver.isBuiltin}), extra keys) stays a
 *   verbatim object.
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
  /**
   * A resolved resource's current display name, for a stored shape that carries one beside the
   * id (the skills encoding of {@link ResourceNode}); `null` when unknown. Without it, the key
   * stands in for the name.
   */
  nameOf?(kind: ResourceKind, id: string): string | null
  /**
   * Whether `id` names a resource Sim ships rather than the workspace stores (a built-in skill).
   * It has no key, so canonicalize keeps its stored entry verbatim without
   * `W_CANON_UNRESOLVED_ID`: the id is valid, not a miss.
   */
  isBuiltin?(kind: ResourceKind, id: string): boolean
  /**
   * The keys a source could name for `kind`, when the caller loaded them: an unknown key's
   * finding lists them with a did-you-mean. `undefined` when not loaded.
   */
  keysOf?(kind: ResourceKind): readonly string[] | undefined
}

/**
 * An internal id the resolver could not map to a key (deleted resource or foreign workspace). Kept
 * verbatim so materialize writes the same bytes back; canonicalize emits `W_CANON_UNRESOLVED_ID`.
 */
export interface UnresolvedNode {
  $sim: 'unresolved'
  kind: ResourceKind | 'var'
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

/**
 * How an agent may call a tool (`usageControl`): the one list canonicalize, compile and the
 * {@link UsageControl} type read, so a new control fails to type-check until each stage takes it.
 */
export const USAGE_CONTROLS = ['auto', 'force', 'none'] as const

type UsageControl = (typeof USAGE_CONTROLS)[number]

/** Whether a stored or written value is one of the {@link USAGE_CONTROLS}. */
export function isUsageControl(value: unknown): value is UsageControl {
  return typeof value === 'string' && USAGE_CONTROLS.some((control) => control === value)
}

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
  usageControl?: UsageControl
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

/** One condition or router branch, keyed by its source branch name. */
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
 * The loop types the executor runs (`Loop['loopType']`). Every per-type rule (the container forms,
 * the executable view, canonicalize's guard) derives from this list, so a new type fails to
 * type-check until each one handles it.
 */
export const LOOP_TYPES = ['for', 'forEach', 'while', 'doWhile'] as const

export type LoopType = (typeof LOOP_TYPES)[number]

/** Whether a value is one of the {@link LOOP_TYPES}. */
export function isLoopType(value: unknown): value is LoopType {
  return typeof value === 'string' && LOOP_TYPES.some((type) => type === value)
}

/** The parallel types the executor runs (`Parallel['parallelType']`), like {@link LOOP_TYPES}. */
export const PARALLEL_TYPES = ['count', 'collection'] as const

export type ParallelType = (typeof PARALLEL_TYPES)[number]

/** Whether a value is one of the {@link PARALLEL_TYPES}. */
export function isParallelType(value: unknown): value is ParallelType {
  return typeof value === 'string' && PARALLEL_TYPES.some((type) => type === value)
}

/**
 * Loop config as it executes (`loopSpec` in canonicalize): each field from `block.data` first,
 * which the serializer rebuilds loops from, with the `loops` map (`Loop`) filling a field `data`
 * omits. The count is the exception: the map's count is read only when `data.count` is not a
 * number (the loader repairs it from the map), and a missing one is the 5 that runs. Optional
 * fields are absent exactly when both omit them; a missing or unknown type is `for`.
 */
export interface LoopSpec {
  kind: 'loop'
  loopType: LoopType
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
  parallelType?: ParallelType
  count?: number
  distribution?: Json
  /** Raw stored value; the runtime clamps to 1–20 (`clampParallelBatchSize`). */
  batchSize?: number
}

/** One block of the canonical workflow, keyed by its normalized name. */
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

/** A workflow variable, keyed by its normalized name. */
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

/** A whole workflow in canonical form: what canonicalize returns and compile produces. */
export interface CanonicalWorkflow {
  modelVersion: 1
  meta: CanonicalWorkflowMeta
  blocks: Record<BlockKey, CanonicalBlock>
  /** Sorted by `(from, portKey(port), to)` with `compareStrings`; no duplicate tuples. */
  edges: CanonicalEdge[]
  variables: Record<VarKey, CanonicalVariable>
  annotations: WorkflowAnnotations
}
