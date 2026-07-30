import { getWorkflowSearchDependentClears } from '@/lib/workflows/search-replace/dependencies'
import { getBlock } from '@/blocks/registry'

/**
 * Clear every TRANSITIVE `dependsOn` descendant of `changedParamId` in a nested tool's params,
 * mirroring the top-level block clear (`use-collaborative-workflow`). Reuses the shared
 * {@link getWorkflowSearchDependentClears} walk - transitive BFS plus canonical-pair expansion, so a
 * basic OR advanced member change clears the dependent - so both surfaces clear identically. Only
 * descendants that currently hold a non-empty value are reset to `''`; the changed param itself and
 * non-descendants are untouched. Returns the same reference when nothing changed.
 */
export function clearDependentToolParams(
  toolType: string,
  params: Record<string, string>,
  changedParamId: string
): Record<string, string> {
  const subBlocks = getBlock(toolType)?.subBlocks ?? []
  let next: Record<string, string> | null = null
  for (const { subBlockId } of getWorkflowSearchDependentClears(subBlocks, changedParamId)) {
    if (!params[subBlockId]) continue
    next ??= { ...params }
    next[subBlockId] = ''
  }
  return next ?? params
}
