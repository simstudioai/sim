import type { WorkflowDiffSummary } from '@/lib/workflows/comparison/compare'
import { normalizedStringify } from '@/lib/workflows/comparison/normalize'
import { sanitizeWorkflowForSharing } from '@/lib/workflows/credentials/credential-extractor'
import { getBlock } from '@/blocks/registry'
import type { BlockState, WorkflowState } from '@/stores/workflows/workflow/types'

export type ComparisonValue =
  | { kind: 'unset' }
  | { kind: 'redacted' }
  | { kind: 'value'; value: unknown }

interface PublicFieldChange {
  field: string
  oldValue: ComparisonValue
  newValue: ComparisonValue
}

export interface PublicWorkflowDiffSummary
  extends Omit<WorkflowDiffSummary, 'modifiedBlocks' | 'containerChanges'> {
  modifiedBlocks: Array<
    Omit<WorkflowDiffSummary['modifiedBlocks'][number], 'changes'> & {
      changes: PublicFieldChange[]
    }
  >
  containerChanges: Array<
    Omit<WorkflowDiffSummary['containerChanges'][number], 'changes'> & {
      changes: PublicFieldChange[]
    }
  >
}

const BLOCK_FIELDS = new Set([
  'type',
  'name',
  'enabled',
  'errorEnabled',
  'retry',
  'horizontalHandles',
  'advancedMode',
  'triggerMode',
])

function visibleValue(value: unknown): ComparisonValue {
  return value == null ? { kind: 'unset' } : { kind: 'value', value }
}

/** Compare first, then apply the same credential policy as public version reads. */
export function redactWorkflowDiffSummary(
  summary: WorkflowDiffSummary,
  base: WorkflowState,
  target: WorkflowState
): PublicWorkflowDiffSummary {
  const options = {
    preserveEnvVars: true,
    preserveWorkspaceBindings: true,
    redactOpaqueCredentialInputs: true,
  }
  const safeBase = sanitizeWorkflowForSharing(base, options)
  const safeTarget = sanitizeWorkflowForSharing(target, options)
  const valueFor = (
    block: BlockState | undefined,
    safe: typeof safeBase,
    blockId: string,
    field: string,
    value: unknown
  ): ComparisonValue => {
    if (value == null) return { kind: 'unset' }
    if (!block) return { kind: 'redacted' }
    if (Object.hasOwn(block.subBlocks, field)) {
      const config = getBlock(block.type)?.subBlocks.find((subBlock) => subBlock.id === field)
      if (!config) return { kind: 'redacted' }
      const projected = safe.blocks?.[blockId]?.subBlocks?.[field]?.value
      return normalizedStringify(projected) === normalizedStringify(value)
        ? visibleValue(projected)
        : { kind: 'redacted' }
    }
    return BLOCK_FIELDS.has(field) || field === 'data.canonicalModes'
      ? visibleValue(value)
      : { kind: 'redacted' }
  }
  return {
    ...summary,
    modifiedBlocks: summary.modifiedBlocks.map((block) => ({
      ...block,
      changes: block.changes.map((change) => ({
        field: change.field,
        oldValue: valueFor(
          base.blocks[block.id],
          safeBase,
          block.id,
          change.field,
          change.oldValue
        ),
        newValue: valueFor(
          target.blocks[block.id],
          safeTarget,
          block.id,
          change.field,
          change.newValue
        ),
      })),
    })),
    containerChanges: summary.containerChanges.map((container) => ({
      ...container,
      changes: container.changes.map((change) => ({
        field: change.field,
        oldValue: visibleValue(change.oldValue),
        newValue: visibleValue(change.newValue),
      })),
    })),
  }
}
