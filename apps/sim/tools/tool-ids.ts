import { stripVersionSuffix } from '@sim/utils/string'
import rawToolIds from '@/tools/generated/tool-ids'

/**
 * Tool id resolution, without importing the executable registry.
 *
 * Resolving a tool name and checking whether one exists need only the registry's
 * key set — never a `ToolConfig` — so this module carries just the ids (~100 KB
 * versus ~4 MB for params or outputs). `@/tools/metadata` and
 * `@/tools/metadata-outputs` both resolve through here, which is what keeps them
 * independent of each other.
 *
 * Semantics mirror `resolveToolId`/`getTool` in `@/tools/utils` exactly,
 * including returning the input unchanged when nothing matches. See
 * `.agents/skills/tool-registry-boundary/SKILL.md`.
 */
/**
 * Frozen because {@link getToolIds} hands it out directly. Returning a copy
 * would allocate on every call in the loops that consume it; freezing makes an
 * in-place `sort()`/`push()` by a caller throw rather than silently corrupt
 * every later lookup.
 */
const toolIds: readonly string[] = Object.freeze(rawToolIds)

const toolIdSet = new Set(toolIds)

/**
 * Base name -> newest versioned id, built once.
 *
 * `@/tools/utils` rebuilds this on every unresolved lookup; the id set is static
 * at runtime, so caching it is behaviour-identical and drops the repeated O(n)
 * scan.
 */
let latestByBaseName: Map<string, string> | null = null

function getLatestByBaseName(): Map<string, string> {
  if (latestByBaseName) return latestByBaseName

  const versions = new Map<string, { toolId: string; version: number }>()
  for (const toolId of toolIds) {
    const baseName = stripVersionSuffix(toolId)
    const versionMatch = toolId.match(/_v(\d+)$/)
    const version = versionMatch ? Number.parseInt(versionMatch[1], 10) : 1
    const previous = versions.get(baseName)
    if (!previous || version > previous.version) {
      versions.set(baseName, { toolId, version })
    }
  }

  latestByBaseName = new Map()
  for (const [baseName, { toolId }] of versions) {
    latestByBaseName.set(baseName, toolId)
  }
  return latestByBaseName
}

/** Every registered tool id, including versioned variants. Frozen — copy before sorting. */
export function getToolIds(): readonly string[] {
  return toolIds
}

/**
 * Resolves a tool name to its registered id, mapping an unversioned name onto
 * the newest version (`notion_search` -> `notion_search_v2`). Returns the input
 * unchanged when nothing matches, matching `@/tools/utils`.
 */
export function resolveToolId(toolName: string): string {
  if (toolIdSet.has(toolName)) return toolName
  return getLatestByBaseName().get(toolName) ?? toolName
}

/** Whether `toolId` names a built-in tool, resolving unversioned names. */
export function hasToolId(toolId: string): boolean {
  return toolIdSet.has(resolveToolId(toolId))
}
