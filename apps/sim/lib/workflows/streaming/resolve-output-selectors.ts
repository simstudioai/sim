import { getErrorMessage } from '@sim/utils/errors'
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

/**
 * Resolves a current-workflow block reference, naming the blocks the caller could
 * have meant when it matches none. A silently empty `blockOutputs` made a typo in
 * `--select-output` indistinguishable from a block that produced nothing; the
 * available names are the fix, so they travel with the refusal. An ambiguous
 * reference (two blocks normalizing to one name) keeps the resolver's own error.
 */
function resolveCurrentBlockId(
  blockRef: string,
  selector: string,
  currentBlocks: Record<string, BlockState>
): string {
  try {
    return resolveOutputBlockRef(blockRef, currentBlocks)
  } catch (error) {
    const blocks = Object.values(currentBlocks)
    const normalizedRef = normalizeName(blockRef)
    const known = blocks.some(
      (block) => block.id === blockRef || normalizeName(block.name || '') === normalizedRef
    )
    if (known) throw error
    const available = blocks
      .map((block) => block.name?.trim() || block.id)
      .sort((a, b) => a.localeCompare(b))
    throw new Error(
      `Unknown block "${blockRef}" in selector "${selector}". Available blocks: ${available.join(', ')}`
    )
  }
}

function createSelectorResolver(
  currentBlocks: Record<string, BlockState>
): (selector: string) => string {
  const currentBlockRefs = new Set<string>()
  const childWorkflowIds = new Set<string>()
  for (const block of Object.values(currentBlocks)) {
    currentBlockRefs.add(block.id)
    currentBlockRefs.add(normalizeName(block.name || ''))
    const childWorkflowId = getWorkflowInvocationTarget(block)
    if (childWorkflowId) childWorkflowIds.add(childWorkflowId)
  }

  return (selector) => {
    const parsed = parseStoredOutputSelector(selector, { currentBlockRefs, childWorkflowIds })
    const blockId = parsed.workflowId
      ? parsed.blockId
      : resolveCurrentBlockId(parsed.blockId, selector, currentBlocks)
    return formatInternalOutputSelector(blockId, parsed.path, parsed.workflowId)
  }
}

/**
 * Resolves current-workflow names and leaves child names for its authorized loader. Throws on
 * the first selector that names no block, so a caller can refuse the request before running.
 */
export function resolveOutputSelectors({
  selectedOutputs,
  currentBlocks,
}: ResolveOutputSelectorsOptions): string[] | undefined {
  if (!selectedOutputs || selectedOutputs.length === 0) return selectedOutputs?.slice()
  return selectedOutputs.map(createSelectorResolver(currentBlocks))
}

export interface LenientOutputSelectorResolution {
  /** Resolved internal selectors, in caller order, without the rejected ones. */
  selectedOutputs: string[]
  rejected: Array<{ selector: string; reason: string }>
}

/**
 * Resolves like {@link resolveOutputSelectors} but drops a selector that names no block
 * instead of throwing. For surfaces whose contract has always tolerated a stale selector,
 * where refusing it now would break callers that worked before.
 */
export function resolveOutputSelectorsLeniently({
  selectedOutputs,
  currentBlocks,
}: ResolveOutputSelectorsOptions): LenientOutputSelectorResolution {
  const resolution: LenientOutputSelectorResolution = { selectedOutputs: [], rejected: [] }
  if (!selectedOutputs || selectedOutputs.length === 0) return resolution
  const resolve = createSelectorResolver(currentBlocks)
  for (const selector of selectedOutputs) {
    try {
      resolution.selectedOutputs.push(resolve(selector))
    } catch (error) {
      resolution.rejected.push({ selector, reason: getErrorMessage(error) })
    }
  }
  return resolution
}
