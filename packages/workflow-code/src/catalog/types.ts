/**
 * The block catalog: a JSON projection of the block, trigger and tool registries that the
 * compiler, printer, canonicalizer and SDK codegen read instead of the registries themselves.
 * It is pure data: every function in a registry definition is either evaluated once per
 * deployment by the projection or marked `{ opaque: true }`.
 *
 * Served as a hashed core shard. The `Catalog*` types below are the expanded shape consumers
 * read; the core shard encodes them compactly ("Core-shard encoding" further down) and `view.ts`
 * expands it.
 */

import type { OutputCondition, PrimitiveValueType, SubBlockType } from '@sim/workflow-types/blocks'
import type { CanonicalParamId, Json, ResourceKind, SubBlockId } from '../model'

/**
 * How a subBlock stores a value. `json-string` means the subBlock holds JSON text (tools,
 * condition/router rows, tableRows, inputFormat, tag filters). Only materialize reads
 * this: the CWM is encoding-free.
 */
export type ParamStorage = 'native' | 'json-string'

/** A function-form condition or option list the projection could not evaluate to data. */
export interface OpaqueMarker {
  opaque: true
}

/** The object form of a registry subBlock condition (`SubBlockConfig.condition`). */
export interface SubBlockConditionClause {
  field: SubBlockId
  value: string | number | boolean | Array<string | number | boolean>
  not?: boolean
  and?: {
    field: SubBlockId
    value: string | number | boolean | Array<string | number | boolean> | undefined
    not?: boolean
  }
}

/**
 * A visibility condition. Function conditions (19 in the registry) become
 * `{ opaque: true }`, which counts as active for `inactive`.
 */
export type CatalogCondition = SubBlockConditionClause | OpaqueMarker

/**
 * How a value for this subBlock is written in source and checked by `W_VALUE_KIND`, derived from
 * the subBlock type:
 * - `string`, `number`, `boolean`, `array`, `object`, `json`: plain JSON of that shape.
 * - `code`: a code body (`code` subBlock, non-JSON language), printed `js```/`py```/`sh```.
 * - `branches`: condition-input / router-input, lifted into named branches.
 * - `tools`: tool-input lists.
 * - `resource`: a workspace resource by key (`resourceKind` says which). Selector-kind, so a pair
 *   member of this kind is the basic member.
 * - `picked`: an opaque provider id from a remote selector (`picked('C0123')`); basic.
 * - `upload`: a workspace file (`file('path')`); basic.
 * - `none`: display-only or server-managed (text, schedule-info, webhook-config, modal); never
 *   written in source.
 */
export type CatalogValueKind =
  | 'string'
  | 'number'
  | 'boolean'
  | 'array'
  | 'object'
  | 'json'
  | 'code'
  | 'branches'
  | 'tools'
  | 'resource'
  | 'picked'
  | 'upload'
  | 'none'

/** Structured subBlock types whose stored JSON canonicalize decodes. */
export type CatalogStructuredKind =
  | 'tools'
  | 'branches'
  | 'tableRows'
  | 'inputFormat'
  | 'variables'
  | 'skills'

/** A static dropdown option of a subBlock, as the expanded catalog serves it. */
export interface CatalogOption {
  id: string
  label: string
}

/**
 * A static option as the core shard stores it: `label` is absent when it equals `id`, and on a
 * block's non-`operation` subBlocks, whose labels are display text nothing reads.
 */
interface CatalogOptionEntry {
  id: string
  label?: string
}

/** One subBlock (field) of a block or trigger, in expanded form. */
export interface CatalogSubBlock {
  id: SubBlockId
  type: SubBlockType
  title?: string
  mode?: 'basic' | 'advanced' | 'both' | 'trigger' | 'trigger-advanced'
  canonicalParamId?: CanonicalParamId
  /**
   * Which declaration of a duplicated id this is. Action and trigger copies of one id coexist
   * (canonical/block-spec.ts); the catalog keeps both.
   */
  surface?: 'action' | 'trigger'
  condition?: CatalogCondition
  /**
   * Per operation id, whether this subBlock is visible, precomputed by the catalog projection when
   * `condition` is a function (and so `{ opaque: true }` here). Absent for data conditions, which
   * consumers evaluate themselves. An operation missing from the map counts as visible.
   */
  visibleFor?: Record<string, boolean>
  /**
   * Per operation id that `visibleFor` shows, the data clause on other fields the condition still
   * asks under that operation (Slack's `send` keeps the channel behind `destinationType`). An
   * operation missing here asks nothing more. Read by compile's field checks only.
   */
  visibleWhen?: Record<string, SubBlockConditionClause>
  /**
   * Per model id of the block's own `model` options, whether this subBlock is visible, precomputed
   * when `condition` is a function of the selected model (the Vertex, Bedrock and API key fields of
   * model blocks). A model the condition cannot decide alone is left out. Read by compile's field
   * checks only.
   */
  visibleForModel?: Record<string, boolean>
  required?: boolean | CatalogCondition
  /** UI clearing and fetch ordering only; never part of types or visibility. */
  dependsOn?: { all: SubBlockId[]; any: SubBlockId[] }
  defaultValue?: Json
  /**
   * The registry `value()` thunk: a constant when it ignores its params, else `computed`. A
   * computed thunk carries `initial`, what it returns for a new block with no values (the value
   * canvas creation seeds), when that is the same every time; a thunk that mints a fresh value per
   * call has none.
   */
  valueDefault?: { constant: Json } | { computed: true; initial?: Json }
  /**
   * Static options; `dynamic` when fetched through `selectorKey`/`fetchOptions`; `opaque` for a
   * function the projection could not evaluate.
   */
  options?: CatalogOption[] | { dynamic: true } | OpaqueMarker
  /**
   * The static `options` are a registry function of deployment settings (a feature or a flag),
   * evaluated where this catalog was built: the server's field gate evaluates it again at write
   * time, so a catalog built elsewhere, or before the settings changed, may list other options.
   */
  optionsVary?: true
  hidden?: boolean
  readOnly?: boolean
  password?: boolean
  hideFromCopilot?: boolean
  context?: 'tool-input'
  paramVisibility?: string
  emptyIsValid?: boolean
  language?: string
  /** Holds a list: a multi-file upload, or a dropdown/combobox with registry `multiSelect`. */
  multiple?: boolean
  min?: number
  max?: number
  /** Slider increment (registry `step`). */
  step?: number
  /** Slider accepts integers only (registry `integer`). */
  integer?: boolean
  /** Column headers of a `table` subBlock, in order (registry `columns`). */
  columns?: string[]
  selectorKey?: string
  serviceId?: string
  /**
   * The credential providers an `oauth-input` with a `serviceId` accepts: the OAuth service's
   * provider id, its service-account provider and any further provider ids it is reachable
   * through, as saved credentials record them.
   */
  credentialProviders?: string[]
  valueKind: CatalogValueKind
  /** Set iff `valueKind` is `resource`. */
  resourceKind?: ResourceKind
  /** Encoding for a value with no prev raw value; prev's encoding wins when it exists. */
  storage: ParamStorage
  structured?: CatalogStructuredKind
  /** Free text the runtime also takes as a number (a `200` written to a short input). */
  acceptsNumber?: boolean
  /** Text whose JSON-looking content is user text (code, long input): never decoded as JSON. */
  neverDecoded?: boolean
  /** A table filter: builder rows or a predicate, checked against what the table runtime accepts. */
  tableFilter?: boolean
  /**
   * The shape the subBlock's value takes in a tool entry's `params` (`getSubBlockValueShape`,
   * tools/param-shape.ts), which canonicalize decodes a stored tool param by. Absent is `string`.
   */
  valueShape?: 'number' | 'boolean' | 'json'
}

/** One output field (`OutputFieldDefinition`, recursively expanded). */
export interface CatalogOutput {
  type: PrimitiveValueType
  description?: string
  condition?: OutputCondition
  hiddenFromDisplay?: boolean
  properties?: Record<string, CatalogOutput>
  items?: CatalogOutput
}

interface CatalogBlockLifecycle {
  hidden?: true
  preview?: true
  sunset?: { status: 'legacy' | 'deprecated'; replacedBy?: string }
}

/** A registry `subBlocks` id rename applied by load-time migrations, for CLI hints. */
export interface CatalogLegacyId {
  from: SubBlockId
  to: SubBlockId | null
  whenOperation?: string[]
  conditional?: true
}

/** Graph facts compile needs and the registry spreads over several helpers. */
export interface CatalogBlockGraph {
  /** False for trigger-category blocks: nothing may connect into them (`E_TARGET_TRIGGER`). */
  canBeTarget: boolean
  /** Whether the block exposes an error port (`E_ERROR_PORT_UNSUPPORTED`). */
  errorPort: boolean
  /** `loop` / `parallel` for containers, else `null`. */
  container: 'loop' | 'parallel' | null
  /** The note block: no edges at all (`isWorkflowAnnotationOnlyBlockType`). */
  annotationOnly: boolean
  /** The subBlock lifted into named branches, for condition and router blocks. */
  branches?: { subBlockId: SubBlockId; kind: 'condition' | 'router' }
}

/**
 * The outputs one operation's tool returns, by name, where they differ from the block's outputs
 * (the editor's output picker reads the tool's outputs too): `names` lists the block outputs the
 * tool declares, in block order, and `nullable` those of them it may return as `null`.
 */
interface CatalogOperationOutputs {
  names: string[]
  nullable?: string[]
}

/** Which param shapes a block's outputs at run time. */
export interface CatalogDynamicOutputs {
  /**
   * `responseFormat`: agent structured output; `inputFormat`: start/trigger input fields;
   * `humanForm`: human-in-the-loop form fields; `tableRows`: table row columns.
   */
  source: 'responseFormat' | 'inputFormat' | 'humanForm' | 'tableRows'
  /** The subBlock id (or canonical param id) that holds the shape. */
  param: string
}

/** A block type in expanded form: what `catalogBlock()` returns. */
export interface CatalogBlock {
  type: string
  name: string
  category: 'blocks' | 'tools' | 'triggers'
  /**
   * `false` for a type that may stay in a workflow but must not be added: types already stored in
   * this workflow but no longer offered, hidden legacy versions, preview
   * blocks. Compile rejects a new block of such a type; an existing one keeps compiling.
   */
  addable?: false
  lifecycle?: CatalogBlockLifecycle
  triggerAllowed?: boolean
  triggers?: { enabled: boolean; available: string[] }
  /** Only one instance per workflow (`duplicate_single_instance_block` gate). */
  singleInstance?: boolean
  /** Declared order (the printer's param order), duplicates kept. */
  subBlocks: CatalogSubBlock[]
  /**
   * `operation`: the tool is chosen by the operation dropdown; `opaque`: by a
   * `tools.config.tool` function the projection cannot evaluate.
   */
  tools: { access: string[]; selector: 'single' | 'operation' | 'opaque' }
  outputs: Record<string, CatalogOutput>
  /**
   * Per operation id, the outputs its tool returns (`CatalogOperationOutputs`), for a block whose
   * operation picks the tool. An operation missing here returns every block output.
   */
  operationOutputs?: Record<string, CatalogOperationOutputs>
  /**
   * Present when outputs derive from a param at run time. Compile and codegen read output paths
   * from that param's value; where it cannot be read statically, any path is allowed and
   * `W_UNKNOWN_OUTPUT_PATH` is skipped.
   */
  dynamicOutputs?: CatalogDynamicOutputs
  graph: CatalogBlockGraph
  legacyIds?: CatalogLegacyId[]
  legacyCanonicalIds?: Array<{ from: CanonicalParamId; to: CanonicalParamId }>
  /**
   * The user-facing name source writes for a param, per surface: param name (a canonical id or a
   * subBlock id) → alias (`oauthCredential` → `credential`). Frozen in
   * `apps/sim/blocks/sdk-names/`; read through `paramAliases` in `catalog/surface.ts`.
   */
  paramAliases?: Partial<Record<'action' | 'trigger', Record<string, string>>>
  /** Present for per-org `custom_block_<slug>` types. */
  custom?: { sourceWorkflowId?: string }
}

/** A shared trigger in expanded form: what `catalogTrigger()` returns. */
export interface CatalogTrigger {
  id: string
  provider: string
  name: string
  polling?: boolean
  webhook?: boolean
  /** Namespaced as `getTrigger()` returns them. */
  subBlocks: CatalogSubBlock[]
  outputs: Record<string, CatalogOutput>
}

/**
 * One SDK builder method, keyed in `BlockCatalog.builders` by its dotted SDK path
 * (`slack.sendMessage`, `trigger.gmail.newEmail`). Method names are frozen in
 * `apps/sim/blocks/sdk-names/`.
 */
export interface CatalogBuilder {
  /** The registry block type the builder creates. */
  type: string
  /** The stored `operation` dropdown id the builder pins (unchanged by renames). */
  operation?: string
  /** True for trigger-mode builders. */
  triggerMode?: boolean
  /**
   * Other subBlock values the builder pins, such as `selectedTriggerId`. Writing `operation` or a
   * key here in source is `E_FIXED_PARAM`.
   */
  fixed?: Record<SubBlockId, string>
}

/*
 * Core-shard encoding. The served catalog never repeats itself: a block's trigger-mode subBlocks
 * point at the shared `triggers` table, a subBlock declared identically by several blocks is
 * stored once in `subBlocks`, condition value lists repeated across fields are stored once in
 * `lists`, and option labels that nothing reads are dropped. Every expanded type above is also a
 * valid entry, so a catalog written in expanded form is a valid core shard. Read a catalog only
 * through `catalog/view.ts`, which expands it.
 */

/** A condition value list stored once at `BlockCatalog.lists[list]`. */
export interface CatalogListRef {
  list: number
}

type ClauseValue = SubBlockConditionClause['value']

/** `SubBlockConditionClause` with value lists possibly interned. */
interface CatalogConditionClauseEntry {
  field: SubBlockId
  value: ClauseValue | CatalogListRef
  not?: boolean
  and?: {
    field: SubBlockId
    value: ClauseValue | CatalogListRef | undefined
    not?: boolean
  }
}

export type CatalogConditionEntry = CatalogConditionClauseEntry | OpaqueMarker

/** A subBlock as the core shard stores it. */
export interface CatalogSubBlockEntry
  extends Omit<CatalogSubBlock, 'condition' | 'required' | 'options'> {
  condition?: CatalogConditionEntry
  required?: boolean | CatalogConditionEntry
  options?: CatalogOptionEntry[] | { dynamic: true } | OpaqueMarker
}

/** A subBlock stored once at `BlockCatalog.subBlocks[shared]`. */
export interface CatalogSharedSubBlockRef {
  shared: number
}

/**
 * `count` consecutive subBlocks of the shared trigger `trigger`, from index `start`, spliced into a
 * block's subBlocks in place. Each expands with `surface: 'trigger'`: a block spreads a trigger's
 * subBlocks into its trigger surface (`...getTrigger(id).subBlocks`).
 */
export interface CatalogTriggerSubBlocksRef {
  trigger: string
  start: number
  count: number
}

/**
 * An output as the core shard stores it: a nested record repeated elsewhere in the catalog is
 * stored once at `BlockCatalog.outputs[sharedProperties]` instead of in `properties`.
 */
export interface CatalogOutputEntry extends Omit<CatalogOutput, 'properties' | 'items'> {
  properties?: Record<string, CatalogOutputEntry>
  sharedProperties?: number
  items?: CatalogOutputEntry
}

/** A block's or trigger's outputs: inline, or stored once at `BlockCatalog.outputs[sharedOutputs]`. */
interface CatalogOutputsEntry {
  outputs?: Record<string, CatalogOutputEntry>
  sharedOutputs?: number
}

/** A block type as the core shard stores it; expands to a {@link CatalogBlock}. */
export interface CatalogBlockEntry
  extends Omit<CatalogBlock, 'subBlocks' | 'outputs'>,
    CatalogOutputsEntry {
  subBlocks: Array<CatalogSubBlockEntry | CatalogSharedSubBlockRef | CatalogTriggerSubBlocksRef>
}

/** A shared trigger as the core shard stores it; expands to a {@link CatalogTrigger}. */
export interface CatalogTriggerEntry
  extends Omit<CatalogTrigger, 'subBlocks' | 'outputs'>,
    CatalogOutputsEntry {
  subBlocks: Array<CatalogSubBlockEntry | CatalogSharedSubBlockRef>
}

/**
 * The block catalog core shard served to compile and print: every block type, shared trigger and
 * builder of one SDK major, in the encoding above. Read it only through `catalog/view.ts`.
 */
export interface BlockCatalog {
  catalogVersion: 1
  /** Content hash of the core shard; the ETag and `SourceBase.catalogHash`. */
  hash: string
  /** The SDK major this catalog serves (`// @sim-sdk N`). */
  sdkMajor: number
  blocks: Record<string, CatalogBlockEntry>
  triggers: Record<string, CatalogTriggerEntry>
  /** Interned subBlocks, referenced by `CatalogSharedSubBlockRef`. */
  subBlocks?: CatalogSubBlockEntry[]
  /** Interned condition value lists, referenced by `CatalogListRef`. */
  lists?: Array<Array<string | number | boolean>>
  /** Interned output records, referenced by `sharedOutputs` and `sharedProperties`. */
  outputs?: Array<Record<string, CatalogOutputEntry>>
  /**
   * Generated builder methods by dotted SDK path. A stored type with no entry here (legacy,
   * unknown, or `custom_block_*` with no generated method) prints and compiles through the
   * generic builder `block(type, name, params, meta?)` (`GENERIC_BUILDER` in `sdk.ts`), so every
   * type always round-trips.
   */
  builders: Record<string, CatalogBuilder>
  /** Present when the catalog includes an organization's custom blocks. */
  scope?: { organizationId: string }
}

/**
 * A catalog with every block and trigger expanded: the shape the projection builds and every
 * consumer reads (through `catalog/view.ts`). The core shard is its compact encoding.
 */
export interface ExpandedBlockCatalog
  extends Omit<BlockCatalog, 'blocks' | 'triggers' | 'subBlocks' | 'lists' | 'outputs'> {
  blocks: Record<string, CatalogBlock>
  triggers: Record<string, CatalogTrigger>
}
