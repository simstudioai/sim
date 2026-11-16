import { compareStrings } from '@sim/utils/string'
import type { ApplyDiagnosticCode, Diagnostic } from '@sim/workflow-code'
import { isNonEmptyValue } from '@sim/workflow-code/catalog/canonical-index'
import { type BlockState, normalizeWorkflowBlockName } from '@sim/workflow-types/workflow'
import { isEqual } from 'es-toolkit'
import { hasWorkspaceSandboxAccess } from '@/lib/billing/core/subscription'
import { MAX_PLAN_REQUIRED } from '@/lib/execution/remote-sandbox/entitlement'
import type { PermissionGroupConfig } from '@/lib/permission-groups/fields'
import { diffGraphs, type GraphDiff, type SourceGraph } from '@/lib/workflows/code/apply/graph-diff'
import { hasDisabledAncestor } from '@/lib/workflows/editing/block-enablement'
import {
  createSubBlockInputGate,
  filterDisallowedTools,
  normalizeTools,
} from '@/lib/workflows/editing/builders'
import { refuseSunsetPlacement } from '@/lib/workflows/editing/operations'
import type {
  EditWorkflowOperation,
  SkippedItem,
  SkippedItemType,
  ValidationError,
} from '@/lib/workflows/editing/types'
import { isBlockTypeAllowed, preValidateCredentialInputs } from '@/lib/workflows/editing/validation'
import { validateToolBindingAuthoring } from '@/lib/workflows/tool-input/authoring'
import { TriggerUtils } from '@/lib/workflows/triggers/triggers'
import { getBlock } from '@/blocks/registry'

/**
 * The editing engine's per-user gates, applied to a whole-graph diff instead of to edit
 * operations (s4 D1). The engine skips a refused item and applies the rest; source apply is
 * atomic (s4 D5), so every refusal here is an error diagnostic and nothing is written.
 *
 * Gates run on added and changed blocks only, as the engine runs them on the blocks an operation
 * names: a stored block the caller left alone is never refused for a policy that changed after
 * it was placed. Call inside `withBlockVisibility`, as `applyOperationsToWorkflowState` is, so
 * the deployment-visibility checks see the acting user's overlay.
 */

/** Skip reasons a graph diff can produce. A deferred forward reference cannot exist in source. */
type GatedSkipType = Exclude<SkippedItemType, 'invalid_edge_target'>

/**
 * The engine's skip vocabulary as apply codes (DESIGN.md decision 14). Total, so a new skip
 * reason fails to compile until it has a code.
 */
export const SKIP_TYPE_APPLY_CODES = {
  block_not_found: 'E_APPLY_BLOCK_NOT_FOUND',
  invalid_block_type: 'E_APPLY_INVALID_BLOCK_TYPE',
  block_not_allowed: 'E_APPLY_BLOCK_NOT_ALLOWED',
  model_not_allowed: 'E_APPLY_MODEL_NOT_ALLOWED',
  block_locked: 'E_APPLY_LOCKED_BLOCK',
  tool_not_allowed: 'E_APPLY_TOOL_NOT_ALLOWED',
  invalid_edge_source: 'E_APPLY_INVALID_EDGE_SOURCE',
  invalid_edge_scope: 'E_APPLY_INVALID_EDGE_SCOPE',
  invalid_source_handle: 'E_APPLY_INVALID_SOURCE_HANDLE',
  invalid_target_handle: 'E_APPLY_INVALID_TARGET_HANDLE',
  invalid_subblock_field: 'E_APPLY_INVALID_SUBBLOCK_FIELD',
  missing_required_params: 'E_APPLY_MISSING_REQUIRED_PARAMS',
  invalid_subflow_parent: 'E_APPLY_INVALID_SUBFLOW_PARENT',
  nested_subflow_not_allowed: 'E_APPLY_NESTED_SUBFLOW_NOT_ALLOWED',
  duplicate_block_name: 'E_APPLY_DUPLICATE_BLOCK_NAME',
  reserved_block_name: 'E_APPLY_RESERVED_BLOCK_NAME',
  retry_not_supported: 'E_APPLY_RETRY_NOT_SUPPORTED',
  duplicate_trigger: 'E_APPLY_DUPLICATE_TRIGGER',
  duplicate_single_instance_block: 'E_APPLY_DUPLICATE_SINGLE_INSTANCE_BLOCK',
  disabled_ancestor: 'E_APPLY_DISABLED_ANCESTOR',
} as const satisfies Record<GatedSkipType, ApplyDiagnosticCode>

type GateErrorCode =
  | (typeof SKIP_TYPE_APPLY_CODES)[GatedSkipType]
  | 'E_APPLY_CREDENTIAL_UNREACHABLE'
  | 'E_APPLY_SANDBOX_PLAN_REQUIRED'

export type SourceGateDiagnostic = Diagnostic<
  GateErrorCode | 'W_APPLY_HOSTED_KEY_DROPPED' | 'W_APPLY_TYPE_CHANGED'
>

export interface GateSourceDiffArgs {
  base: SourceGraph
  target: SourceGraph
  /** Defaults to `diffGraphs(base, target)`. */
  diff?: GraphDiff
  permissionConfig: PermissionGroupConfig | null
  /** The governed human subject: credential reachability is checked as this user. */
  subjectUserId: string
  workspaceId: string
  /** Copilot writes are held to the internal tool-binding authoring contract. */
  isCopilot: boolean
}

const CONTAINER_TYPES: ReadonlySet<string> = new Set(['loop', 'parallel'])
const TOOLS_SUBBLOCK_ID = 'tools'
const SANDBOX_SUBBLOCK_ID = 'sandboxId'

interface GatedBlock {
  block: BlockState
  /** Subblock ids whose value the diff sets: every non-empty one for an added block. */
  changedFields: string[]
  baseBlock?: BlockState
  added: boolean
  typeChanged: boolean
  enabledChanged: boolean
}

function blockKeyOf(block: BlockState): string {
  return normalizeWorkflowBlockName(block.name ?? '')
}

function subBlockValue(block: BlockState | undefined, field: string): unknown {
  return block?.subBlocks?.[field]?.value
}

function collectGatedBlocks(base: SourceGraph, target: SourceGraph, diff: GraphDiff): GatedBlock[] {
  const gated: GatedBlock[] = []
  for (const id of diff.added) {
    const block = target.blocks[id]
    gated.push({
      block,
      changedFields: Object.keys(block.subBlocks ?? {})
        .filter((field) => isNonEmptyValue(subBlockValue(block, field)))
        .sort(compareStrings),
      added: true,
      typeChanged: false,
      enabledChanged: false,
    })
  }
  for (const change of diff.modified) {
    const block = target.blocks[change.id]
    const baseBlock = base.blocks[change.id]
    gated.push({
      block,
      baseBlock,
      changedFields: change.subBlocks.filter(
        (field) => !isEqual(subBlockValue(baseBlock, field), subBlockValue(block, field))
      ),
      added: false,
      typeChanged: change.typeChanged,
      enabledChanged: change.enabledChanged,
    })
  }
  return gated
}

/**
 * The block-type gates the engine runs on `add`, `insert_into_subflow` and an `edit` that
 * changes `type`: registry membership, deployment visibility plus the integration allowlist, and
 * the sunset refusal. Returns whether the placement passed.
 */
function gateBlockPlacement(
  entry: GatedBlock,
  permissionConfig: PermissionGroupConfig | null,
  skipped: SkippedItem[]
): boolean {
  const { block } = entry
  const operationType = entry.added ? 'add' : 'edit'
  if (CONTAINER_TYPES.has(block.type)) return true
  if (!getBlock(block.type)) {
    skipped.push({
      type: 'invalid_block_type',
      operationType,
      blockId: block.id,
      reason: `Invalid block type "${block.type}"`,
      details: { requestedType: block.type },
    })
    return false
  }
  if (!isBlockTypeAllowed(block.type, permissionConfig)) {
    skipped.push({
      type: 'block_not_allowed',
      operationType,
      blockId: block.id,
      reason: `Block type "${block.type}" is unavailable in this deployment or blocked by access control`,
      details: { requestedType: block.type },
    })
    return false
  }
  return !refuseSunsetPlacement(skipped, {
    blockType: block.type,
    operationType,
    blockId: block.id,
    outcome: entry.added ? 'block not added' : 'type change refused',
  })
}

/**
 * Trigger uniqueness against the target graph: a new (or retyped) block may not be a second
 * single-instance trigger or block. The other blocks are the target's, so replacing a trigger in
 * one apply (remove the old, add the new) passes.
 */
function gateTriggerUniqueness(
  entry: GatedBlock,
  target: SourceGraph,
  skipped: SkippedItem[]
): void {
  const { block } = entry
  const operationType = entry.added ? 'add' : 'edit'
  const others = Object.values(target.blocks).filter((other) => other.id !== block.id)
  const triggerIssue = TriggerUtils.getTriggerAdditionIssue(others, block.type)
  if (triggerIssue) {
    skipped.push({
      type: 'duplicate_trigger',
      operationType,
      blockId: block.id,
      reason: `Cannot add ${triggerIssue.triggerName} - a workflow can only have one`,
      details: { requestedType: block.type, issue: triggerIssue.issue },
    })
    return
  }
  const singleInstanceIssue = TriggerUtils.getSingleInstanceBlockIssue(others, block.type)
  if (singleInstanceIssue) {
    skipped.push({
      type: 'duplicate_single_instance_block',
      operationType,
      blockId: block.id,
      reason: `Cannot add ${singleInstanceIssue.blockName} - a workflow can only have one`,
      details: { requestedType: block.type },
    })
  }
}

/** The model/operation allowlist and the tool denylist, on the values the diff sets. */
function gateFieldValues(
  entry: GatedBlock,
  permissionConfig: PermissionGroupConfig | null,
  record: (skipped: SkippedItem[], param: string) => void
): void {
  const { block, baseBlock } = entry
  const operationType = entry.added ? 'add' : 'edit'
  for (const field of entry.changedFields) {
    const skipped: SkippedItem[] = []
    const isInputAllowed = createSubBlockInputGate({
      blockType: block.type,
      permissionConfig,
      blockId: block.id,
      operationType,
      skippedItems: skipped,
    })
    const value = subBlockValue(block, field)
    isInputAllowed(field, value)
    if (field === TOOLS_SUBBLOCK_ID && Array.isArray(value)) {
      const before = subBlockValue(baseBlock, field)
      const previous = Array.isArray(before) ? before : []
      const newEntries = value.filter((tool) => !previous.some((old) => isEqual(old, tool)))
      if (newEntries.length > 0) {
        filterDisallowedTools(normalizeTools(newEntries), permissionConfig, block.id, skipped)
      }
    }
    record(skipped, field)
  }
}

/**
 * Credentials and hosted keys, through the engine's own pre-validation. Each gated block becomes
 * one synthetic `add` or `edit` carrying only the values the diff sets, judged against the base
 * graph, which is exactly the operation the engine would have been sent for the same change.
 */
async function gateCredentialInputs(
  gated: GatedBlock[],
  base: SourceGraph,
  context: { userId: string; workspaceId: string }
): Promise<ValidationError[]> {
  const operations: EditWorkflowOperation[] = []
  for (const entry of gated) {
    if (entry.changedFields.length === 0) continue
    const inputs: Record<string, unknown> = {}
    for (const field of entry.changedFields) {
      const value = subBlockValue(entry.block, field)
      if (value !== undefined && value !== null) inputs[field] = value
    }
    operations.push({
      operation_type: entry.added ? 'add' : 'edit',
      block_id: entry.block.id,
      params: {
        ...(entry.added || entry.typeChanged ? { type: entry.block.type } : {}),
        inputs,
      },
    })
  }
  if (operations.length === 0) return []
  // double-cast-allowed: the pre-validator reads the graph as an open record, like the engine; `WorkflowState` has no index signature.
  const snapshot = base as unknown as Record<string, unknown>
  const { errors } = await preValidateCredentialInputs(operations, context, snapshot)
  return errors
}

function isCredentialField(blockType: string, field: string): boolean {
  return Boolean(
    getBlock(blockType)?.subBlocks.some((sb) => sb.id === field && sb.type === 'oauth-input')
  )
}

function sandboxChanged(entry: GatedBlock): boolean {
  if (!entry.changedFields.includes(SANDBOX_SUBBLOCK_ID)) return false
  return entry.added ? isNonEmptyValue(subBlockValue(entry.block, SANDBOX_SUBBLOCK_ID)) : true
}

/**
 * Runs the editing engine's per-user gates over the diff from `base` (the stored graph) to
 * `target` (the materialized source) and returns one diagnostic per refusal. Error diagnostics
 * refuse the whole apply; `W_APPLY_HOSTED_KEY_DROPPED` names a platform-managed key the use case
 * must leave unset, and `W_APPLY_TYPE_CHANGED` a block that keeps its id under a new type.
 *
 * Locked blocks are refused separately, by `findLockedBlockRefusals`.
 */
export async function gateSourceDiff(args: GateSourceDiffArgs): Promise<SourceGateDiagnostic[]> {
  const { base, target, permissionConfig, subjectUserId, workspaceId, isCopilot } = args
  const diff = args.diff ?? diffGraphs(base, target)
  const gated = collectGatedBlocks(base, target, diff)
  const diagnostics: SourceGateDiagnostic[] = []

  const record = (skipped: SkippedItem[], param?: string) => {
    for (const item of skipped) {
      if (item.type === 'invalid_edge_target') continue
      const block = target.blocks[item.blockId] ?? base.blocks[item.blockId]
      diagnostics.push({
        code: SKIP_TYPE_APPLY_CODES[item.type],
        severity: 'error',
        message: item.reason,
        blockId: item.blockId,
        ...(block ? { blockKey: blockKeyOf(block) } : {}),
        ...(param ? { param } : {}),
      })
    }
  }

  for (const entry of gated) {
    const { block } = entry
    if (entry.added || entry.typeChanged) {
      const skipped: SkippedItem[] = []
      const placed = gateBlockPlacement(entry, permissionConfig, skipped)
      if (placed) gateTriggerUniqueness(entry, target, skipped)
      record(skipped)
      if (!placed) continue
    }
    if (entry.typeChanged) {
      diagnostics.push({
        code: 'W_APPLY_TYPE_CHANGED',
        severity: 'warning',
        message: `Block "${block.name}" changes type from "${entry.baseBlock?.type}" to "${block.type}" and keeps its id`,
        blockId: block.id,
        blockKey: blockKeyOf(block),
      })
    }

    gateFieldValues(entry, permissionConfig, record)

    if (isCopilot) {
      const toolInputs = getBlock(block.type)?.subBlocks.filter((sb) => sb.type === 'tool-input')
      for (const subBlock of toolInputs ?? []) {
        if (!entry.changedFields.includes(subBlock.id)) continue
        const error = validateToolBindingAuthoring(
          block.type,
          subBlockValue(block, subBlock.id),
          subBlockValue(entry.baseBlock, subBlock.id)
        )
        if (error) {
          diagnostics.push({
            code: 'E_APPLY_INVALID_SUBBLOCK_FIELD',
            severity: 'error',
            message: error,
            blockId: block.id,
            blockKey: blockKeyOf(block),
            param: subBlock.id,
          })
        }
      }
    }

    if (
      entry.enabledChanged &&
      block.enabled !== false &&
      hasDisabledAncestor(block.id, target.blocks)
    ) {
      diagnostics.push({
        code: 'E_APPLY_DISABLED_ANCESTOR',
        severity: 'error',
        message: `Cannot enable block "${block.name}" while one of its parent containers is disabled. Enable the parent first.`,
        blockId: block.id,
        blockKey: blockKeyOf(block),
      })
    }
  }

  const credentialErrors = await gateCredentialInputs(gated, base, {
    userId: subjectUserId,
    workspaceId,
  })
  for (const error of credentialErrors) {
    const block = target.blocks[error.blockId]
    const located = {
      message: error.error,
      blockId: error.blockId,
      param: error.field,
      ...(block ? { blockKey: blockKeyOf(block) } : {}),
    }
    diagnostics.push(
      isCredentialField(error.blockType, error.field)
        ? { code: 'E_APPLY_CREDENTIAL_UNREACHABLE', severity: 'error', ...located }
        : { code: 'W_APPLY_HOSTED_KEY_DROPPED', severity: 'warning', ...located }
    )
  }

  const sandboxBlocks = gated.filter(sandboxChanged)
  if (sandboxBlocks.length > 0 && !(await hasWorkspaceSandboxAccess(workspaceId))) {
    for (const { block } of sandboxBlocks) {
      diagnostics.push({
        code: 'E_APPLY_SANDBOX_PLAN_REQUIRED',
        severity: 'error',
        message: MAX_PLAN_REQUIRED,
        blockId: block.id,
        blockKey: blockKeyOf(block),
        param: SANDBOX_SUBBLOCK_ID,
      })
    }
  }

  return diagnostics
}
