import { isRecordLike, omit } from '@sim/utils/object'
import { isEqual } from 'es-toolkit'
import {
  buildCanonicalIndex,
  type CanonicalIndex,
  type CanonicalMode,
  type CanonicalModeOverrides,
  isCanonicalPair,
  matchRewrittenTools,
} from '@/lib/workflows/subblocks/visibility'
import { buildAgentToolUsageControlCanonicalKey } from '@/lib/workflows/tool-input/usage-control'
import { getBlock } from '@/blocks/registry'

export type ToolCanonicalIndexResolver = (toolType: string) => CanonicalIndex | null

interface ApplySuppliedToolModesOptions {
  tools: readonly unknown[]
  /** The list this edit replaced, or `undefined` when every tool is new. */
  originalTools?: readonly unknown[]
  /** Overrides already keyed by the tools' final positions. */
  canonicalModes: CanonicalModeOverrides | undefined
  getCanonicalIndex: ToolCanonicalIndexResolver
  /** Agent tools also carry the Permission Mode pair. */
  includePermissionMode: boolean
}

interface SuppliedToolModes {
  tools: unknown[]
  canonicalModes: Record<string, CanonicalMode>
}

/** Resolves each tool type's canonical basic/advanced groups once per resolver. */
export function createToolCanonicalIndexResolver(): ToolCanonicalIndexResolver {
  const indexByType = new Map<string, CanonicalIndex | null>()
  return (toolType) => {
    if (!indexByType.has(toolType)) {
      const subBlocks = getBlock(toolType)?.subBlocks
      indexByType.set(toolType, subBlocks ? buildCanonicalIndex(subBlocks) : null)
    }
    return indexByType.get(toolType) ?? null
  }
}

function withoutExpandedState(tool: Record<string, unknown>): Record<string, unknown> {
  return omit(tool, ['isExpanded'])
}

/**
 * Selects each tool pair's basic/advanced mode from the side a serialized tool list supplies, and
 * keeps the inactive side the caller left out. An edit replaces the whole list, so a tool switched
 * by sending one side would otherwise lose the other side's stored value. Supplying both sides
 * keeps the current mode, because a read-and-resend round trip includes both. Supplying neither
 * leaves a nested pair as sent and returns Permission Mode to its documented `auto` Selector
 * default. A pair resent with unchanged values keeps its mode, and tools identical to their
 * previous entry are left untouched.
 */
export function applySuppliedToolModes({
  tools,
  originalTools,
  canonicalModes: overrides,
  getCanonicalIndex,
  includePermissionMode,
}: ApplySuppliedToolModesOptions): SuppliedToolModes {
  const canonicalModes: Record<string, CanonicalMode> = {}
  for (const [key, mode] of Object.entries(overrides ?? {})) {
    if (mode) canonicalModes[key] = mode
  }

  const previousIndexByIndex = new Map<number, number>()
  if (originalTools) {
    for (const [previousIndex, index] of matchRewrittenTools(originalTools, tools)) {
      previousIndexByIndex.set(index, previousIndex)
    }
  }

  const nextTools = tools.map((tool, toolIndex) => {
    if (!isRecordLike(tool)) return tool

    const previousIndex = previousIndexByIndex.get(toolIndex)
    const matched = previousIndex === undefined ? undefined : originalTools?.[previousIndex]
    const previous = isRecordLike(matched) ? matched : undefined
    if (previous && isEqual(withoutExpandedState(previous), withoutExpandedState(tool))) {
      return tool
    }

    let next: Record<string, unknown> = tool
    const canonicalIndex = typeof tool.type === 'string' ? getCanonicalIndex(tool.type) : null
    if (canonicalIndex) {
      const params = isRecordLike(tool.params) ? tool.params : {}
      const previousParams = isRecordLike(previous?.params) ? previous.params : {}
      const carriedParams: Record<string, unknown> = {}

      for (const group of Object.values(canonicalIndex.groupsById)) {
        if (!isCanonicalPair(group)) continue
        const basicIds = group.basicId ? [group.basicId] : []
        const basicSupplied = basicIds.some((id) => params[id] !== undefined)
        const advancedSupplied = group.advancedIds.some((id) => params[id] !== undefined)
        if (basicSupplied === advancedSupplied) continue
        const pairIds = [...basicIds, ...group.advancedIds]
        if (previous && pairIds.every((id) => isEqual(params[id], previousParams[id]))) continue

        canonicalModes[`${toolIndex}:${group.canonicalId}`] = advancedSupplied
          ? 'advanced'
          : 'basic'
        for (const id of advancedSupplied ? basicIds : group.advancedIds) {
          if (params[id] === undefined && previousParams[id] !== undefined) {
            carriedParams[id] = previousParams[id]
          }
        }
      }

      if (Object.keys(carriedParams).length > 0) {
        next = { ...next, params: { ...params, ...carriedParams } }
      }
    }

    if (includePermissionMode) {
      const key = buildAgentToolUsageControlCanonicalKey(toolIndex)
      const hasFixedValue = tool.usageControl !== undefined
      const hasExpression = tool.usageControlExpression !== undefined

      if (hasExpression && !hasFixedValue) {
        canonicalModes[key] = 'advanced'
        if (previous?.usageControl !== undefined) {
          next = { ...next, usageControl: previous.usageControl }
        }
      } else if (!hasExpression) {
        delete canonicalModes[key]
        if (hasFixedValue && previous?.usageControlExpression !== undefined) {
          next = { ...next, usageControlExpression: previous.usageControlExpression }
        }
      }
    }

    return next
  })

  return { tools: nextTools, canonicalModes }
}
