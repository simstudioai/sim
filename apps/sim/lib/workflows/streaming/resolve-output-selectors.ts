import type { BlockState } from '@sim/workflow-types/workflow'
import { getWorkflowInvocationTarget } from '@/lib/workflows/streaming/nested-output-options'
import {
  formatInternalOutputSelector,
  parseStoredOutputSelector,
  resolveOutputBlockRef,
} from '@/lib/workflows/streaming/output-selector'
import { normalizeName } from '@/executor/constants'

interface ResolveOutputSelectorsOptions {
  selectedOutputs: readonly string[] | undefined
  currentBlocks: Record<string, BlockState>
}

/** Resolves current-workflow names and leaves child names for its authorized loader. */
export function resolveOutputSelectors({
  selectedOutputs,
  currentBlocks,
}: ResolveOutputSelectorsOptions): string[] | undefined {
  if (!selectedOutputs || selectedOutputs.length === 0) return selectedOutputs?.slice()

  const currentBlockRefs = new Set<string>()
  const childWorkflowIds = new Set<string>()
  for (const block of Object.values(currentBlocks)) {
    currentBlockRefs.add(block.id)
    currentBlockRefs.add(normalizeName(block.name || ''))
    const childWorkflowId = getWorkflowInvocationTarget(block)
    if (childWorkflowId) childWorkflowIds.add(childWorkflowId)
  }

  return selectedOutputs.map((selector) => {
    const parsed = parseStoredOutputSelector(selector, { currentBlockRefs, childWorkflowIds })
    const blockId = parsed.workflowId
      ? parsed.blockId
      : resolveOutputBlockRef(parsed.blockId, currentBlocks)
    return formatInternalOutputSelector(blockId, parsed.path, parsed.workflowId)
  })
}
