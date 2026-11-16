/**
 * The block catalog: a JSON projection of the block, trigger and tool registries that the
 * compiler, printer, canonicalizer and SDK codegen read instead of the registries themselves
 * (s1 §2 `BlockCatalog`, build-spec decision 14). It is pure data: every function in a registry
 * definition is either evaluated once per deployment by the projection or marked
 * `{ opaque: true }`.
 *
 * Served as a hashed core shard plus per-block docs shards; fields marked "docs shard" are absent
 * from the core shard.
 */

import type { OutputCondition, PrimitiveValueType, SubBlockType } from '@sim/workflow-types/blocks'
import type { CanonicalParamId, Json, ParamStorage, ResourceKind, SubBlockId } from '../model'

/** A function-form condition or option list the projection could not evaluate to data. */
export interface OpaqueMarker {
  opaque: true
}

/** The object form of a registry subBlock condition (apps/sim/blocks/types.ts:428-448). */
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
 * A visibility condition. Function conditions (19 in the registry, s1 §8) become
 * `{ opaque: true }`, which counts as active for `inactive` (s1 canonicalize step 9).
 */
export type CatalogCondition = SubBlockConditionClause | OpaqueMarker

/**
 * How a value for this subBlock is written in source and checked by `W_VALUE_KIND`, derived from
 * the subBlock type (build-spec decision 14; s2 §2 mapping table):
 * - `string`, `number`, `boolean`, `array`, `object`, `json`: plain JSON of that shape.
 * - `code`: a code body (`code` subBlock, non-JSON language), printed `js```/`py```/`sh```.
 * - `branches`: condition-input / router-input, lifted into named branches.
 * - `tools`: tool-input lists.
 * - `resource`: a workspace resource by key (`resourceKind` says which). Selector-kind, so a pair
 *   member of this kind is the basic member (build-spec decision 7).
 * - `picked`: an opaque provider id from a remote selector (`picked('C0123')`); basic.
 * - `upload`: a workspace file upload (`upload('path')`); basic.
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

/** Structured subBlock types whose stored JSON canonicalize decodes (s1 canonicalize step 3). */
export type CatalogStructuredKind = 'tools' | 'branches' | 'tableRows' | 'inputFormat' | 'variables'

export interface CatalogOption {
  id: string
  label: string
}

export interface CatalogSubBlock {
  id: SubBlockId
  type: SubBlockType
  title?: string
  mode?: 'basic' | 'advanced' | 'both' | 'trigger' | 'trigger-advanced'
  canonicalParamId?: CanonicalParamId
  /**
   * Which declaration of a duplicated id this is. Action and trigger copies of one id coexist
   * (canonical/block-spec.ts:35-63, s1 quirk 14); the catalog keeps both.
   */
  surface?: 'action' | 'trigger'
  condition?: CatalogCondition
  required?: boolean | CatalogCondition
  /** UI clearing and fetch ordering only; never part of types or visibility (s2 §2). */
  dependsOn?: { all: SubBlockId[]; any: SubBlockId[] }
  defaultValue?: Json
  /** The registry `value()` thunk: a constant when it ignores its params, else `computed`. */
  valueDefault?: { constant: Json } | { computed: true }
  /**
   * Static options; `dynamic` when fetched through `selectorKey`/`fetchOptions`; `opaque` for a
   * function the projection could not evaluate (build-spec decision 14).
   */
  options?: CatalogOption[] | { dynamic: true } | OpaqueMarker
  hidden?: boolean
  readOnly?: boolean
  password?: boolean
  hideFromCopilot?: boolean
  context?: 'tool-input'
  paramVisibility?: string
  emptyIsValid?: boolean
  language?: string
  multiple?: boolean
  min?: number
  max?: number
  selectorKey?: string
  serviceId?: string
  valueKind: CatalogValueKind
  /** Set iff `valueKind` is `resource`. */
  resourceKind?: ResourceKind
  /** Preferred encoding for a new value; prev's encoding wins when it exists (s1 D1). */
  storage: ParamStorage
  structured?: CatalogStructuredKind
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

export interface CatalogBlockLifecycle {
  hidden?: true
  preview?: true
  sunset?: { status: 'legacy' | 'deprecated'; replacedBy?: string }
}

/** A registry `subBlocks` id rename applied by load-time migrations, for CLI hints (s1 D7). */
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

export interface CatalogBlock {
  type: string
  name: string
  category: 'blocks' | 'tools' | 'triggers'
  lifecycle?: CatalogBlockLifecycle
  triggerAllowed?: boolean
  triggers?: { enabled: boolean; available: string[] }
  /** Only one instance per workflow (`duplicate_single_instance_block` gate). */
  singleInstance?: boolean
  /** Declared order (the printer's param order), duplicates kept (s1 quirk 14). */
  subBlocks: CatalogSubBlock[]
  /**
   * `operation`: the tool is chosen by the operation dropdown; `opaque`: by a
   * `tools.config.tool` function the projection cannot evaluate.
   */
  tools: { access: string[]; selector: 'single' | 'operation' | 'opaque' }
  inputs: Record<string, { type: string; schema?: Json }>
  outputs: Record<string, CatalogOutput>
  /**
   * Outputs derived from params at run time (agent `responseFormat`, start `inputFormat`, HITL
   * form, table rows), so any path is allowed and `W_UNKNOWN_OUTPUT_PATH` is skipped.
   */
  dynamicOutputs: boolean
  graph: CatalogBlockGraph
  legacyIds?: CatalogLegacyId[]
  legacyCanonicalIds?: Array<{ from: CanonicalParamId; to: CanonicalParamId }>
  /** Present for per-org `custom_block_<slug>` types. */
  custom?: { sourceWorkflowId?: string }
  /** Docs shard. */
  description?: string
}

export interface CatalogTrigger {
  id: string
  provider: string
  name: string
  polling?: boolean
  webhook?: boolean
  /** Namespaced as `getTrigger()` returns them (triggers/index.ts:10-63). */
  subBlocks: CatalogSubBlock[]
  outputs: Record<string, CatalogOutput>
}

/** Docs shard. */
export interface CatalogTool {
  id: string
  params: Record<
    string,
    {
      type: string
      required?: boolean
      visibility: 'user-or-llm' | 'user-only' | 'llm-only' | 'hidden'
      default?: Json
      description?: string
    }
  >
  outputs: Record<string, CatalogOutput>
}

/**
 * One SDK builder method, keyed in `BlockCatalog.builders` by its dotted SDK path
 * (`slack.sendMessage`, `trigger.gmail.newEmail`). Method names are frozen in
 * `apps/sim/blocks/sdk-names.json` (build-spec decision 7).
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

export interface BlockCatalog {
  catalogVersion: 1
  /** Content hash of the core shard; the ETag and `lock.catalogHash`. */
  hash: string
  /** The SDK major this catalog serves (`// @sim-sdk N`). */
  sdkMajor: number
  blocks: Record<string, CatalogBlock>
  triggers: Record<string, CatalogTrigger>
  builders: Record<string, CatalogBuilder>
  /** Docs shard. */
  tools?: Record<string, CatalogTool>
  /** Present when the catalog includes an organization's custom blocks. */
  scope?: { organizationId: string }
}
