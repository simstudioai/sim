import { getTransitiveSubBlockDependents } from '@/lib/workflows/subblocks/dependencies'
import type { StoredTool } from '@/lib/workflows/tool-input/types'
import { getBlock } from '@/blocks/registry'
import type { ToolMetadata } from '@/tools/metadata'
import { isUserFacingToolParam } from '@/tools/params'

/**
 * Clear every TRANSITIVE `dependsOn` descendant of `changedParamId` in a nested tool's params,
 * mirroring the top-level block clear (`use-collaborative-workflow`). Reuses the shared
 * {@link getTransitiveSubBlockDependents} walk - transitive BFS plus canonical-pair expansion, so a
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
  for (const { subBlockId } of getTransitiveSubBlockDependents(subBlocks, [changedParamId])) {
    if (!params[subBlockId]) continue
    next ??= { ...params }
    next[subBlockId] = ''
  }
  return next ?? params
}

/** Keeps user-configured inputs that the newly selected operation accepts. */
export function getParamsForToolOperation(
  tool: Pick<StoredTool, 'type' | 'params'>,
  nextTool: ToolMetadata
): Record<string, string> {
  const newParamIds = new Set(
    Object.entries(nextTool.params ?? {})
      .filter(([, param]) => isUserFacingToolParam(param))
      .map(([paramId]) => paramId)
  )
  const subBlocks = getBlock(tool.type)?.subBlocks ?? []
  if (nextTool.oauth) {
    const credentialControls = subBlocks.filter(
      (subBlock) =>
        subBlock.type === 'oauth-input' && subBlock.serviceId === nextTool.oauth?.provider
    )
    const credentialCanonicalIds = new Set(
      credentialControls.flatMap((subBlock) =>
        subBlock.canonicalParamId ? [subBlock.canonicalParamId] : []
      )
    )
    for (const subBlock of subBlocks) {
      if (
        credentialControls.includes(subBlock) ||
        (subBlock.canonicalParamId &&
          credentialCanonicalIds.has(subBlock.canonicalParamId) &&
          (!subBlock.serviceId || subBlock.serviceId === nextTool.oauth.provider))
      ) {
        newParamIds.add(subBlock.id)
        if (subBlock.canonicalParamId) newParamIds.add(subBlock.canonicalParamId)
      }
    }
  }
  const preservedParams: Record<string, string> = {}
  Object.entries(tool.params || {}).forEach(([paramId, value]) => {
    if (newParamIds.has(paramId) && value) preservedParams[paramId] = value
  })
  return clearDependentToolParams(tool.type, preservedParams, 'operation')
}
