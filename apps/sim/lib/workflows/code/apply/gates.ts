import { compareStrings } from '@sim/utils/string'
import {
  type ApplyDiagnosticCode,
  type BlockCatalog,
  catalogBlock,
  type Diagnostic,
} from '@sim/workflow-code'
import { isNonEmptyValue } from '@sim/workflow-code/catalog/canonical-index'
import type { BlockState } from '@sim/workflow-types/workflow'
import { isEqual } from 'es-toolkit'
import { hasWorkspaceSandboxAccess } from '@/lib/billing/core/subscription'
import { MAX_PLAN_REQUIRED } from '@/lib/execution/remote-sandbox/entitlement'
import type { PermissionGroupConfig } from '@/lib/permission-groups/fields'
import type { GraphDiff, SourceGraph } from '@/lib/workflows/code/apply/graph-diff'
import { toolInputIds } from '@/lib/workflows/code/catalog/workspace'
import { hasDisabledAncestor } from '@/lib/workflows/editing/block-enablement'
import { normalizeTools } from '@/lib/workflows/editing/builders'
import {
  checkBlockPlacement,
  checkRetrySetting,
  createFieldValueGate,
  type GateContext,
  partitionToolEntries,
} from '@/lib/workflows/editing/gates'
import type {
  EditWorkflowOperation,
  SkippedItem,
  SkippedItemType,
  ValidationError,
} from '@/lib/workflows/editing/types'
import { preValidateCredentialInputs } from '@/lib/workflows/editing/validation'
import { validateToolBindingAuthoring } from '@/lib/workflows/tool-input/authoring'
import { getBlock } from '@/blocks/registry'

/**
 * The editing engine's per-user gates, applied to a whole-graph diff instead of to edit
 * operations. `BLOCK_GATES` (`editing/gates.ts`) is the one list both run: the engine withholds
 * what a gate refuses and applies the rest; source apply is atomic, so every refusal here is an
 * error diagnostic and nothing is written. The checks below that are not in that list (credential
 * reachability, the copilot tool-binding contract, enablement, the sandbox plan) call the
 * engine's own functions.
 *
 * Gates run on added and changed blocks only, as the engine runs them on the blocks an operation
 * names: a stored block the caller left alone is never refused for a policy that changed after
 * it was placed. Call inside `withBlockVisibility`, as `applyOperationsToWorkflowState` is, so
 * the deployment-visibility checks see the acting user's overlay.
 */

/**
 * Engine skip reasons source refuses before the gates, so no gate reports them: a deferred forward
 * reference cannot exist in source; compile refuses a duplicate or reserved block name
 * (`E_DUPLICATE_NAME`, `E_RESERVED_NAME`); and a block's container is the `loop` or `parallel` it
 * is declared inside, so its parent can never be missing or another type. The engine never refuses
 * nesting a container in a container either. Compile refuses a cycle the source closes
 * (`E_EDGE_CYCLE`) and keeps a stored one (`W_EDGE_CYCLE`), as the engine does.
 */
type SourceRefusedSkipType =
  | 'invalid_edge_target'
  | 'edge_cycle'
  | 'invalid_subflow_parent'
  | 'nested_subflow_not_allowed'
  | 'duplicate_block_name'
  | 'reserved_block_name'

/** Skip reasons a graph diff can produce. */
type GatedSkipType = Exclude<SkippedItemType, SourceRefusedSkipType>

/**
 * The engine's skip vocabulary as apply codes. Total, so a new skip
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
  retry_not_supported: 'E_APPLY_RETRY_NOT_SUPPORTED',
  duplicate_trigger: 'E_APPLY_DUPLICATE_TRIGGER',
  duplicate_single_instance_block: 'E_APPLY_DUPLICATE_SINGLE_INSTANCE_BLOCK',
  disabled_ancestor: 'E_APPLY_DISABLED_ANCESTOR',
} as const satisfies Record<GatedSkipType, ApplyDiagnosticCode>

function isGatedSkip(item: SkippedItem): item is SkippedItem & { type: GatedSkipType } {
  return Object.hasOwn(SKIP_TYPE_APPLY_CODES, item.type)
}

type GateErrorCode =
  | (typeof SKIP_TYPE_APPLY_CODES)[GatedSkipType]
  | 'E_APPLY_TYPE_NOT_ADDABLE'
  | 'E_APPLY_CREDENTIAL_UNREACHABLE'
  | 'E_APPLY_SANDBOX_PLAN_REQUIRED'

/** A refusal (`E_APPLY_*`) or warning (`W_APPLY_*`) the source gates report for one block. */
export type SourceGateDiagnostic = Diagnostic<
  GateErrorCode | 'W_APPLY_HOSTED_KEY_DROPPED' | 'W_APPLY_TYPE_CHANGED'
>

/** What `gateSourceDiff` judges: the diff, the catalog, and who applies it where. */
export interface GateSourceDiffArgs {
  base: SourceGraph
  target: SourceGraph
  diff: GraphDiff
  /** The per-workflow source catalog: a type it marks `addable: false` may stay but not be placed. */
  catalog: BlockCatalog
  /**
   * The source key of a block by id, for locating a finding in the submitted text: the key the
   * write binds, else the stored one. A legacy collision key (`name~2`) is not the block's name.
   */
  keyOf: (id: string) => string | undefined
  permissionConfig: PermissionGroupConfig | null
  /** The governed human subject: credential reachability is checked as this user. */
  subjectUserId: string
  workspaceId: string
  /** Copilot writes are held to the internal tool-binding authoring contract. */
  isCopilot: boolean
}

const SANDBOX_SUBBLOCK_ID = 'sandboxId'

interface GatedBlock {
  block: BlockState
  /**
   * Subblock ids whose value the diff sets: every non-empty one for an added or retyped block,
   * since a value kept across a type change is judged against the new type's gates.
   */
  changedFields: string[]
  baseBlock?: BlockState
  added: boolean
  typeChanged: boolean
  enabledChanged: boolean
  /**
   * Whether the diff sets a retry policy: a new block with one, a changed one, or one kept across
   * a type change (judged against the new type, like the fields).
   */
  retrySet: boolean
}

function subBlockValue(block: BlockState | undefined, field: string): unknown {
  return block?.subBlocks?.[field]?.value
}

function nonEmptyFields(block: BlockState): string[] {
  return Object.keys(block.subBlocks ?? {})
    .filter((field) => isNonEmptyValue(subBlockValue(block, field)))
    .sort(compareStrings)
}

function hasRetry(block: BlockState): boolean {
  return block.retry !== undefined && block.retry !== null
}

function collectGatedBlocks(base: SourceGraph, target: SourceGraph, diff: GraphDiff): GatedBlock[] {
  const gated: GatedBlock[] = []
  for (const id of diff.added) {
    const block = target.blocks[id]
    gated.push({
      block,
      changedFields: nonEmptyFields(block),
      added: true,
      typeChanged: false,
      enabledChanged: false,
      retrySet: hasRetry(block),
    })
  }
  for (const change of diff.modified) {
    const block = target.blocks[change.id]
    const baseBlock = base.blocks[change.id]
    gated.push({
      block,
      baseBlock,
      changedFields: change.typeChanged
        ? nonEmptyFields(block)
        : change.subBlocks.filter(
            (field) => !isEqual(subBlockValue(baseBlock, field), subBlockValue(block, field))
          ),
      added: false,
      typeChanged: change.typeChanged,
      enabledChanged: change.enabledChanged,
      retrySet: hasRetry(block) && (change.typeChanged || change.attributes.includes('retry')),
    })
  }
  return gated
}

/**
 * Per block id the diff adds or modifies, the subblock ids whose value it sets: the fields the
 * value gate judges ({@link GatedBlock.changedFields}).
 */
export function changedSubBlockFields(
  base: SourceGraph,
  target: SourceGraph,
  diff: GraphDiff
): Map<string, ReadonlySet<string>> {
  return new Map(
    collectGatedBlocks(base, target, diff).map((entry) => [
      entry.block.id,
      new Set(entry.changedFields),
    ])
  )
}

/**
 * The placement gates on a new or retyped block, judged against the target graph's other blocks so
 * replacing a trigger in one apply (remove the old, add the new) passes. Returns whether the
 * placement passed. First, a type the source catalog keeps only for blocks that already use it is
 * refused (`notAddable`); the engine has no such rule, so the gates still run and report alongside
 * it.
 */
function gateBlockPlacement(
  entry: GatedBlock,
  catalog: BlockCatalog,
  others: Array<{ type: string }>,
  ctx: GateContext,
  notAddable: (block: BlockState) => void
): SkippedItem | null {
  const { block } = entry
  if (catalogBlock(catalog, block.type)?.addable === false) notAddable(block)
  return checkBlockPlacement(
    {
      blockId: block.id,
      blockType: block.type,
      previousType: entry.baseBlock?.type,
      operationType: entry.added ? 'add' : 'edit',
      outcome: entry.added ? 'block not added' : 'type change refused',
      others,
    },
    ctx
  )
}

/**
 * The types of the target's other blocks, one witness per type, for a block of type `self`. The
 * uniqueness predicates ask only whether a type is present, so one witness stands for every block
 * of it, and counting once keeps a large create linear instead of scanning the graph per block.
 */
function createOtherTypes(target: SourceGraph): (self: string) => Array<{ type: string }> {
  const counts = new Map<string, number>()
  for (const block of Object.values(target.blocks)) {
    counts.set(block.type, (counts.get(block.type) ?? 0) + 1)
  }
  const byType = new Map<string, Array<{ type: string }>>()
  return (self) => {
    let others = byType.get(self)
    if (!others) {
      others = []
      for (const [type, count] of counts) if (count > (type === self ? 1 : 0)) others.push({ type })
      byType.set(self, others)
    }
    return others
  }
}

/**
 * The field and tool-entry gates on the values the diff sets. Tool entries are judged in every
 * field the block type declares as `tool-input` (an agent's `tools`, a human in the loop's
 * `notification`), and only the entries the stored value did not already hold.
 */
function gateFieldValues(
  entry: GatedBlock,
  toolInputFields: ReadonlySet<string>,
  ctx: GateContext,
  record: (skipped: SkippedItem[], param: string) => void
): void {
  const { block, baseBlock } = entry
  const checkField = createFieldValueGate(
    { blockId: block.id, blockType: block.type, operationType: entry.added ? 'add' : 'edit' },
    ctx
  )
  for (const field of entry.changedFields) {
    const skipped: SkippedItem[] = []
    const value = subBlockValue(block, field)
    const refusal = checkField(field, value)
    if (refusal) skipped.push(refusal)
    if (toolInputFields.has(field) && Array.isArray(value)) {
      const before = entry.typeChanged ? undefined : subBlockValue(baseBlock, field)
      const previous = Array.isArray(before) ? before : []
      const newEntries = value.filter((tool) => !previous.some((old) => isEqual(old, tool)))
      if (newEntries.length > 0) {
        skipped.push(...partitionToolEntries(normalizeTools(newEntries), block.id, ctx).refused)
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

/**
 * Runs the editing engine's per-user gates over the diff from `base` (the stored graph) to
 * `target` (the materialized source) and returns one diagnostic per refusal. Error diagnostics
 * refuse the whole apply; `W_APPLY_HOSTED_KEY_DROPPED` names a platform-managed key the use case
 * must leave unset, and `W_APPLY_TYPE_CHANGED` a block that keeps its id under a new type.
 *
 * Locked blocks are refused separately, by `findLockedBlockRefusals`.
 */
export async function gateSourceDiff(args: GateSourceDiffArgs): Promise<SourceGateDiagnostic[]> {
  const { base, target, diff, catalog, keyOf, permissionConfig, subjectUserId, workspaceId } = args
  const gated = collectGatedBlocks(base, target, diff)
  const diagnostics: SourceGateDiagnostic[] = []
  const otherTypes = createOtherTypes(target)
  const located = (blockId: string) => {
    const blockKey = keyOf(blockId)
    return blockKey === undefined ? { blockId } : { blockId, blockKey }
  }

  const record = (skipped: SkippedItem[], param?: string) => {
    for (const item of skipped) {
      if (!isGatedSkip(item)) {
        throw new Error(
          `A source gate reported ${item.type}, which source refuses before the gates`
        )
      }
      diagnostics.push({
        code: SKIP_TYPE_APPLY_CODES[item.type],
        severity: 'error',
        message: item.reason,
        ...located(item.blockId),
        ...(param ? { param } : {}),
      })
    }
  }

  const ctx: GateContext = { permissionConfig }
  for (const entry of gated) {
    const { block } = entry
    if (entry.added || entry.typeChanged) {
      const refusal = gateBlockPlacement(entry, catalog, otherTypes(block.type), ctx, (refused) =>
        diagnostics.push({
          code: 'E_APPLY_TYPE_NOT_ADDABLE',
          severity: 'error',
          message: `Block type "${refused.type}" can stay where it is already used but cannot be added`,
          ...located(refused.id),
        })
      )
      // A refused placement withholds the block, as the engine does, so nothing else on it is judged.
      if (refusal) {
        record([refusal])
        continue
      }
    }
    if (entry.typeChanged) {
      diagnostics.push({
        code: 'W_APPLY_TYPE_CHANGED',
        severity: 'warning',
        message: `Block "${block.name}" changes type from "${entry.baseBlock?.type}" to "${block.type}" and keeps its id`,
        ...located(block.id),
      })
    }

    if (entry.retrySet) {
      const refusal = checkRetrySetting(
        {
          blockId: block.id,
          blockType: block.type,
          triggerMode: block.triggerMode,
          operationType: entry.added ? 'add' : 'edit',
        },
        ctx
      )
      if (refusal) record([refusal])
    }

    const toolInputFields = new Set(toolInputIds(block.type))
    gateFieldValues(entry, toolInputFields, ctx, record)

    if (args.isCopilot) {
      for (const field of toolInputFields) {
        if (!entry.changedFields.includes(field)) continue
        const error = validateToolBindingAuthoring(
          block.type,
          subBlockValue(block, field),
          subBlockValue(entry.baseBlock, field)
        )
        if (error) {
          diagnostics.push({
            code: 'E_APPLY_INVALID_SUBBLOCK_FIELD',
            severity: 'error',
            message: error,
            ...located(block.id),
            param: field,
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
        ...located(block.id),
      })
    }
  }

  const sandboxBlocks = gated.filter((entry) => entry.changedFields.includes(SANDBOX_SUBBLOCK_ID))
  const [credentialErrors, hasSandboxAccess] = await Promise.all([
    gateCredentialInputs(gated, base, { userId: subjectUserId, workspaceId }),
    sandboxBlocks.length > 0 ? hasWorkspaceSandboxAccess(workspaceId) : true,
  ])
  for (const error of credentialErrors) {
    const finding = { message: error.error, ...located(error.blockId), param: error.field }
    diagnostics.push(
      isCredentialField(error.blockType, error.field)
        ? { code: 'E_APPLY_CREDENTIAL_UNREACHABLE', severity: 'error', ...finding }
        : { code: 'W_APPLY_HOSTED_KEY_DROPPED', severity: 'warning', ...finding }
    )
  }

  if (!hasSandboxAccess) {
    for (const { block } of sandboxBlocks) {
      diagnostics.push({
        code: 'E_APPLY_SANDBOX_PLAN_REQUIRED',
        severity: 'error',
        message: MAX_PLAN_REQUIRED,
        ...located(block.id),
        param: SANDBOX_SUBBLOCK_ID,
      })
    }
  }

  return diagnostics
}
