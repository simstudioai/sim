import { isRecordLike, omit } from '@sim/utils/object'
import { isEqual } from 'es-toolkit'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { MCP_SERVER_ADVANCED_TOOL_TYPE } from '@/lib/mcp/shared'
import { reindexCanonicalModesByPosition } from '@/lib/workflows/subblocks/visibility'

type CanonicalModes = Record<string, 'basic' | 'advanced'>

function describeTool(tool: unknown) {
  if (!isRecordLike(tool)) return undefined
  const params = isRecordLike(tool.params) ? tool.params : {}
  const schema = isRecordLike(tool.schema) ? tool.schema : {}
  const fn = isRecordLike(schema.function) ? schema.function : {}
  const identity =
    tool.type === 'custom-tool'
      ? [tool.type, tool.customToolId ?? fn.name]
      : tool.type === 'mcp' || tool.type === MCP_SERVER_ADVANCED_TOOL_TYPE
        ? [tool.type, params.serverId, params.toolName]
        : [tool.type, tool.operation ?? tool.toolId]
  return { identity, configuration: omit(tool, ['isExpanded', 'title']) }
}

/**
 * API arrays lose object identity. Match unchanged configurations before edited callable
 * identities, then move every indexed mode together. Explicit choices disambiguate only
 * the fields they override; other conflicting choices still require an unambiguous edit.
 */
export function remapToolCanonicalModes(
  previousTools: readonly unknown[],
  tools: readonly unknown[],
  modes: CanonicalModes,
  explicitModes: ReadonlyMap<number, CanonicalModes> = new Map()
): CanonicalModes {
  const previous = previousTools.map(describeTool)
  const current = tools.map(describeTool)
  const newIndexByOldIndex = new Map<number, number>()
  const modesByOldIndex = new Map<number, CanonicalModes>()
  for (const [key, mode] of Object.entries(modes)) {
    const match = /^(\d+):(.+)$/.exec(key)
    if (!match) continue
    const index = Number(match[1])
    const scoped = modesByOldIndex.get(index) ?? {}
    scoped[match[2]] = mode
    modesByOldIndex.set(index, scoped)
  }

  if (isEqual(previous, current)) {
    current.forEach((_, index) => newIndexByOldIndex.set(index, index))
  } else {
    const available = new Set(previous.map((_, index) => index))
    const matched = new Set<number>()
    for (const exact of [true, false]) {
      current.forEach((tool, index) => {
        if (!tool || matched.has(index)) return
        const candidates = [...available].filter((oldIndex) => {
          const oldTool = previous[oldIndex]
          return (
            oldTool && isEqual(exact ? oldTool : oldTool.identity, exact ? tool : tool.identity)
          )
        })
        if (!candidates.length) return
        const effectiveModes = (oldIndex: number) => ({
          ...modesByOldIndex.get(oldIndex),
          ...explicitModes.get(index),
        })
        if (
          candidates.some(
            (oldIndex) => !isEqual(effectiveModes(oldIndex), effectiveModes(candidates[0]))
          )
        ) {
          throw new OrchestrationError(
            'validation',
            `Tool ${index + 1} has ambiguous canonical modes after editing repeated tools. Keep its configuration distinct or explicitly choose each conflicting mode.`
          )
        }
        const oldIndex = candidates[0]
        newIndexByOldIndex.set(oldIndex, index)
        available.delete(oldIndex)
        matched.add(index)
      })
    }
  }

  const result = { ...(reindexCanonicalModesByPosition(newIndexByOldIndex, modes) ?? modes) }
  for (const [index, choices] of explicitModes) {
    for (const [canonicalId, mode] of Object.entries(choices)) {
      result[`${index}:${canonicalId}`] = mode
    }
  }
  return result
}
