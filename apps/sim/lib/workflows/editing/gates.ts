import { isIntegrationDeploymentAvailableForVisibility } from '@/lib/integrations/availability.server'
import { MCP_SERVER_ADVANCED_TOOL_TYPE } from '@/lib/mcp/shared'
import { capabilityDeniedBy } from '@/lib/permission-groups/capability-assertions'
import type { PermissionGroupConfig } from '@/lib/permission-groups/fields'
import { createModelAccessGate } from '@/lib/permission-groups/model-access'
import {
  createToolAccessGate,
  isOperationAllowed,
  MODEL_SUBBLOCK_ID,
  OPERATION_SUBBLOCK_ID,
  type SeedValueGate,
} from '@/lib/permission-groups/operation-access'
import { isRetryEligibleBlock } from '@/lib/workflows/blocks/retry-eligibility'
import type { SkippedItem, SkippedItemType } from '@/lib/workflows/editing/types'
import { isBlockTypeAllowed } from '@/lib/workflows/editing/validation'
import { TriggerUtils } from '@/lib/workflows/triggers/triggers'
import { getBlock } from '@/blocks/registry'
import { isHiddenUnder, overlayVisibility } from '@/blocks/visibility/context'

/**
 * The per-user gates on a block write, as one list every writer runs: the editing engine's
 * operations, which withhold what a gate refuses and apply the rest, and source apply
 * (`code/apply/gates.ts`), which refuses the whole write. A gate added to {@link BLOCK_GATES}
 * applies to both.
 *
 * Each gate judges one subject, and a refusal withholds exactly that subject:
 * - `placement`: a block type being placed (a new block, or a stored block given a type). The
 *   block is not added, or keeps its old type.
 * - `retry`: a retry policy being set. The policy is not written.
 * - `field`: one subblock value being written. That value is not written.
 * - `tool_entry`: one entry of a tool list being written. That entry is dropped from the list.
 */

/** Who writes: the acting user's permission group, or `null` for an ungoverned writer. */
export interface GateContext {
  permissionConfig: PermissionGroupConfig | null
}

/** A block type a write places. */
export interface BlockPlacement {
  blockId: string
  blockType: string
  /** The type a stored block had, for a type change. */
  previousType?: string
  operationType: string
  /** What a refusal withholds, ending the reason: `block not added`, `type change skipped`. */
  outcome: string
  details?: Record<string, unknown>
  /**
   * The graph's other blocks, for the one-per-workflow rules. Absent where the writer does not hold
   * the placement to them.
   */
  others?: Array<{ type: string }> | Record<string, { type: string }>
}

/** A retry policy a write sets on a block. */
export interface RetrySetting {
  blockId: string
  blockType: string
  triggerMode?: boolean
  operationType: string
}

/** The block whose subblock values or tool entries a write sets. */
export interface WrittenBlock {
  blockId: string
  blockType: string
  operationType: string
}

/** A refusal whose type the gate declares. */
type GateRefusal<T extends SkippedItemType> = SkippedItem & { type: T }

interface GateBase<T extends SkippedItemType> {
  /** Every skip type the gate reports; its refusals carry no other. */
  skipTypes: readonly T[]
}

interface PlacementGate<T extends SkippedItemType = SkippedItemType> extends GateBase<T> {
  subject: 'placement'
  check(placement: BlockPlacement, ctx: GateContext): GateRefusal<T> | null
}

interface RetryGate<T extends SkippedItemType = SkippedItemType> extends GateBase<T> {
  subject: 'retry'
  check(setting: RetrySetting, ctx: GateContext): GateRefusal<T> | null
}

/** Judges one subblock value of a block; `null` when the gate has nothing to judge there. */
type FieldCheck<T extends SkippedItemType> = (
  field: string,
  value: unknown
) => GateRefusal<T> | null

interface FieldGate<T extends SkippedItemType = SkippedItemType> extends GateBase<T> {
  subject: 'field'
  /** Built once per block, so a denylist is indexed once rather than per value. */
  forBlock(block: WrittenBlock, ctx: GateContext): FieldCheck<T> | null
}

type ToolEntryCheck<T extends SkippedItemType> = (entry: ToolEntry) => GateRefusal<T> | null

interface ToolEntryGate<T extends SkippedItemType = SkippedItemType> extends GateBase<T> {
  subject: 'tool_entry'
  forBlock(blockId: string, ctx: GateContext): ToolEntryCheck<T> | null
}

export type BlockGate = PlacementGate | RetryGate | FieldGate | ToolEntryGate

/** One entry of a `tool-input` list, as authored. */
export interface ToolEntry {
  type?: unknown
  operation?: string
  title?: string
  customToolId?: string
  params?: { serverId?: unknown }
}

/** Whether the block type declares `field` as a `tool-input`, whose entries the tool-entry gates judge. */
export function isToolInputField(blockType: string, field: string): boolean {
  return Boolean(
    getBlock(blockType)?.subBlocks.some((sb) => sb.id === field && sb.type === 'tool-input')
  )
}

function isContainerType(blockType: string): boolean {
  return blockType === 'loop' || blockType === 'parallel'
}

const REGISTERED_TYPE: PlacementGate<'invalid_block_type'> = {
  subject: 'placement',
  skipTypes: ['invalid_block_type'],
  check: ({ blockType, blockId, operationType, outcome, details }) => {
    if (isContainerType(blockType) || getBlock(blockType)) return null
    return {
      type: 'invalid_block_type',
      operationType,
      blockId,
      reason: `Invalid block type "${blockType}" - ${outcome}`,
      details: { requestedType: blockType, ...details },
    }
  },
}

const AVAILABLE_TYPE: PlacementGate<'block_not_allowed'> = {
  subject: 'placement',
  skipTypes: ['block_not_allowed'],
  check: ({ blockType, blockId, operationType, outcome, details }, { permissionConfig }) => {
    if (isContainerType(blockType) || isBlockTypeAllowed(blockType, permissionConfig)) return null
    return {
      type: 'block_not_allowed',
      operationType,
      blockId,
      reason: `Block type "${blockType}" is unavailable in this deployment or blocked by access control - ${outcome}`,
      details: { requestedType: blockType, ...details },
    }
  },
}

/**
 * Refuses placing a type the acting user cannot see: an unrevealed `preview` block or one the
 * `block-visibility` kill switch names, by the catalog's own predicate ({@link isHiddenUnder}), so a
 * write cannot add a block the catalog hides. Placed instances keep executing and stay editable, so
 * a block keeping its own type is not refused. Reads the visibility in scope: outside
 * `withBlockVisibility` preview blocks stay hidden and nothing is kill-switched.
 */
const VISIBLE_TYPE: PlacementGate<'block_not_allowed'> = {
  subject: 'placement',
  skipTypes: ['block_not_allowed'],
  check: ({ blockType, previousType, blockId, operationType, outcome, details }) => {
    if (blockType === previousType) return null
    const block = getBlock(blockType)
    if (!block || !isHiddenUnder(overlayVisibility(), block)) return null
    return {
      type: 'block_not_allowed',
      operationType,
      blockId,
      reason: `Block type "${blockType}" is not available to you - ${outcome}`,
      details: { requestedType: blockType, ...details },
    }
  },
}

/**
 * Refuses placing a sunset (`legacy` / `deprecated`) type and names its successor. Placed
 * instances keep executing and stay editable, so a block keeping its own type is not refused.
 */
const ACTIVE_TYPE: PlacementGate<'block_not_allowed'> = {
  subject: 'placement',
  skipTypes: ['block_not_allowed'],
  check: ({ blockType, previousType, blockId, operationType, outcome, details }) => {
    if (blockType === previousType) return null
    const sunset = getBlock(blockType)?.sunset
    if (!sunset) return null
    const successor = sunset.replacedBy ? ` - use "${sunset.replacedBy}" instead` : ''
    return {
      type: 'block_not_allowed',
      operationType,
      blockId,
      reason: `Block type "${blockType}" is ${sunset.status}${successor} - ${outcome}`,
      details: { requestedType: blockType, replacedBy: sunset.replacedBy, ...details },
    }
  },
}

const SINGLE_TRIGGER: PlacementGate<'duplicate_trigger'> = {
  subject: 'placement',
  skipTypes: ['duplicate_trigger'],
  check: ({ blockType, blockId, operationType, others }) => {
    if (!others) return null
    const issue = TriggerUtils.getTriggerAdditionIssue(others, blockType)
    if (!issue) return null
    return {
      type: 'duplicate_trigger',
      operationType,
      blockId,
      reason: `Cannot add ${issue.triggerName} - a workflow can only have one`,
      details: { requestedType: blockType, issue: issue.issue },
    }
  },
}

const SINGLE_INSTANCE: PlacementGate<'duplicate_single_instance_block'> = {
  subject: 'placement',
  skipTypes: ['duplicate_single_instance_block'],
  check: ({ blockType, blockId, operationType, others }) => {
    if (!others) return null
    const issue = TriggerUtils.getSingleInstanceBlockIssue(others, blockType)
    if (!issue) return null
    return {
      type: 'duplicate_single_instance_block',
      operationType,
      blockId,
      reason: `Cannot add ${issue.blockName} - a workflow can only have one`,
      details: { requestedType: blockType },
    }
  },
}

/**
 * Eligibility uses the executor's own predicate, so a policy the runtime would ignore (triggers,
 * human-in-the-loop, sentinels) is refused instead of written as dead configuration.
 */
const RETRY_ELIGIBLE: RetryGate<'retry_not_supported'> = {
  subject: 'retry',
  skipTypes: ['retry_not_supported'],
  check: ({ blockId, blockType, triggerMode, operationType }) => {
    if (isRetryEligibleBlock({ blockType, category: getBlock(blockType)?.category, triggerMode })) {
      return null
    }
    return {
      type: 'retry_not_supported',
      operationType,
      blockId,
      reason: `Block "${blockId}" (${blockType}) cannot retry - triggers, human-in-the-loop, and container blocks always run once`,
    }
  },
}

/** Shared allow-everything seed gate, so the unrestricted case allocates nothing. */
const ALLOW_ALL_SEEDS: SeedValueGate = () => true

/**
 * Whether a string may be written to `operation` or `model`, with nothing recorded when it may
 * not: the editor's `isSeededValueAllowed`. A block's declared defaults go through this one, since
 * a default the group denies is simply not seeded; a value the caller sent goes through the
 * `field` gate built on it, which reports the denial.
 */
export function createSeededValueGate(
  blockType: string,
  permissionConfig: PermissionGroupConfig | null | undefined
): SeedValueGate {
  if (!permissionConfig) return ALLOW_ALL_SEEDS

  const isToolAllowed = createToolAccessGate(permissionConfig.deniedTools)
  const isModelUsable = createModelAccessGate(permissionConfig)

  return (key: string, value: string) => {
    if (key === OPERATION_SUBBLOCK_ID) {
      return isOperationAllowed(getBlock(blockType), value, isToolAllowed)
    }
    if (key === MODEL_SUBBLOCK_ID) return isModelUsable(value)
    return true
  }
}

/**
 * The two fields that name something a group has a policy about: `operation` decides which
 * concrete tool the block runs, and `model` names a model id.
 */
const OPERATION_AND_MODEL_ACCESS: FieldGate<'tool_not_allowed' | 'model_not_allowed'> = {
  subject: 'field',
  skipTypes: ['tool_not_allowed', 'model_not_allowed'],
  forBlock: ({ blockId, blockType, operationType }, { permissionConfig }) => {
    if (!permissionConfig) return null
    const isValueAllowed = createSeededValueGate(blockType, permissionConfig)
    return (field, value) => {
      if (typeof value !== 'string' || isValueAllowed(field, value)) return null
      if (field === OPERATION_SUBBLOCK_ID) {
        return {
          type: 'tool_not_allowed',
          operationType,
          blockId,
          reason: `Operation "${value}" on block type "${blockType}" is blocked by access control - operation not set`,
          details: { blockType, operation: value },
        }
      }
      return {
        type: 'model_not_allowed',
        operationType,
        blockId,
        reason: `Model "${value}" is blocked by access control - model not set`,
        details: { blockType, model: value },
      }
    }
  },
}

const DEPLOYED_TOOL: ToolEntryGate<'tool_not_allowed'> = {
  subject: 'tool_entry',
  skipTypes: ['tool_not_allowed'],
  forBlock: (blockId) => {
    const visibility = overlayVisibility()
    return (tool) => {
      if (
        typeof tool.type !== 'string' ||
        !getBlock(tool.type) ||
        isIntegrationDeploymentAvailableForVisibility(tool.type, visibility)
      ) {
        return null
      }
      return {
        type: 'tool_not_allowed',
        operationType: 'add',
        blockId,
        reason: `Tool block type "${tool.type}" is unavailable in this deployment - tool not added`,
        details: { toolType: tool.type },
      }
    }
  },
}

/**
 * The group's tool policy on one entry: the custom-tool and MCP capabilities, then the `deniedTools`
 * denylist, which names a block and (when the block exposes more than one) the operation to run.
 * An absent operation is the single-tool case, where the resolver returns the block's only tool.
 */
const PERMITTED_TOOL: ToolEntryGate<'tool_not_allowed'> = {
  subject: 'tool_entry',
  skipTypes: ['tool_not_allowed'],
  forBlock: (blockId, { permissionConfig }) => {
    if (!permissionConfig) return null
    const isToolAllowed = createToolAccessGate(permissionConfig.deniedTools)
    return (tool) => {
      if (tool.type === 'custom-tool' && capabilityDeniedBy('custom_tools.use', permissionConfig)) {
        return {
          type: 'tool_not_allowed',
          operationType: 'add',
          blockId,
          reason: `Custom tool "${tool.title || tool.customToolId || 'unknown'}" is not allowed by permission group - tool not added`,
          details: { toolType: 'custom-tool', toolId: tool.customToolId },
        }
      }
      if (
        (tool.type === 'mcp' || tool.type === MCP_SERVER_ADVANCED_TOOL_TYPE) &&
        capabilityDeniedBy('mcp_tools.use', permissionConfig)
      ) {
        return {
          type: 'tool_not_allowed',
          operationType: 'add',
          blockId,
          reason: `MCP tool "${tool.title || 'unknown'}" is not allowed by permission group - tool not added`,
          details: { toolType: tool.type, serverId: tool.params?.serverId },
        }
      }
      if (
        typeof tool.type === 'string' &&
        !isOperationAllowed(getBlock(tool.type), tool.operation ?? '', isToolAllowed)
      ) {
        return {
          type: 'tool_not_allowed',
          operationType: 'add',
          blockId,
          reason: `Tool "${tool.type}${tool.operation ? `.${tool.operation}` : ''}" is blocked by access control - tool not added`,
          details: { toolType: tool.type, operation: tool.operation },
        }
      }
      return null
    }
  },
}

/**
 * Every per-user gate on a block write, in the order a writer runs them. Placement gates stop at
 * the first refusal, as a refused type leaves nothing for the next gate to judge.
 */
export const BLOCK_GATES: readonly BlockGate[] = [
  REGISTERED_TYPE,
  AVAILABLE_TYPE,
  VISIBLE_TYPE,
  ACTIVE_TYPE,
  SINGLE_TRIGGER,
  SINGLE_INSTANCE,
  RETRY_ELIGIBLE,
  OPERATION_AND_MODEL_ACCESS,
  DEPLOYED_TOOL,
  PERMITTED_TOOL,
]

const PLACEMENT_GATES = BLOCK_GATES.filter((gate) => gate.subject === 'placement')
const RETRY_GATES = BLOCK_GATES.filter((gate) => gate.subject === 'retry')
const FIELD_GATES = BLOCK_GATES.filter((gate) => gate.subject === 'field')
const TOOL_ENTRY_GATES = BLOCK_GATES.filter((gate) => gate.subject === 'tool_entry')

/** The refusal withholding a placement, or `null` when every placement gate passes. */
export function checkBlockPlacement(
  placement: BlockPlacement,
  ctx: GateContext
): SkippedItem | null {
  for (const gate of PLACEMENT_GATES) {
    const refusal = gate.check(placement, ctx)
    if (refusal) return refusal
  }
  return null
}

/** The refusal withholding a retry policy, or `null` when it may be written. */
export function checkRetrySetting(setting: RetrySetting, ctx: GateContext): SkippedItem | null {
  for (const gate of RETRY_GATES) {
    const refusal = gate.check(setting, ctx)
    if (refusal) return refusal
  }
  return null
}

/** Judges one subblock value; returns the refusal withholding it, or `null`. */
export type FieldValueGate = (field: string, value: unknown) => SkippedItem | null

const ALLOW_ALL_FIELDS: FieldValueGate = () => null

/** The field gates for one block's writes, built once per block. */
export function createFieldValueGate(block: WrittenBlock, ctx: GateContext): FieldValueGate {
  const checks = FIELD_GATES.flatMap((gate) => gate.forBlock(block, ctx) ?? [])
  if (checks.length === 0) return ALLOW_ALL_FIELDS
  return (field, value) => {
    for (const check of checks) {
      const refusal = check(field, value)
      if (refusal) return refusal
    }
    return null
  }
}

/**
 * Splits tool entries into those every tool-entry gate passes and the refusals for the rest. Gates
 * run in list order over the entries the earlier gates kept, so an entry is refused once.
 */
export function partitionToolEntries<T extends ToolEntry>(
  entries: readonly T[],
  blockId: string,
  ctx: GateContext
): { kept: T[]; refused: SkippedItem[] } {
  let kept = [...entries]
  const refused: SkippedItem[] = []
  for (const gate of TOOL_ENTRY_GATES) {
    const check = gate.forBlock(blockId, ctx)
    if (!check) continue
    const passed: T[] = []
    for (const entry of kept) {
      const refusal = check(entry)
      if (refusal) refused.push(refusal)
      else passed.push(entry)
    }
    kept = passed
  }
  return { kept, refused }
}
