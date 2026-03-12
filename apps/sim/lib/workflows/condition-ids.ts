import { EDGE } from '@/executor/constants'

/**
 * Remaps condition/router block IDs in a parsed conditions array.
 * Condition IDs use the format `{blockId}-{suffix}` and must be updated
 * when a block is duplicated to reference the new block ID.
 *
 * @param conditions - Parsed array of condition block objects with `id` fields
 * @param oldBlockId - The original block ID prefix to replace
 * @param newBlockId - The new block ID prefix
 * @returns Whether any IDs were changed (mutates in place)
 */
export function remapConditionBlockIds(
  conditions: Array<{ id: string; [key: string]: unknown }>,
  oldBlockId: string,
  newBlockId: string
): boolean {
  let changed = false
  const prefix = `${oldBlockId}-`
  for (const condition of conditions) {
    if (typeof condition.id === 'string' && condition.id.startsWith(prefix)) {
      const suffix = condition.id.slice(prefix.length)
      condition.id = `${newBlockId}-${suffix}`
      changed = true
    }
  }
  return changed
}

/** Handle prefixes that embed block-scoped condition/route IDs */
const HANDLE_PREFIXES = [EDGE.CONDITION_PREFIX, EDGE.ROUTER_PREFIX] as const

/**
 * Remaps a condition or router edge sourceHandle from the old block ID to the new one.
 * Handle formats:
 * - Condition: `condition-{blockId}-{suffix}`
 * - Router V2: `router-{blockId}-{suffix}`
 *
 * @returns The remapped handle string, or the original if no remapping needed
 */
export function remapConditionEdgeHandle(
  sourceHandle: string,
  oldBlockId: string,
  newBlockId: string
): string {
  for (const handlePrefix of HANDLE_PREFIXES) {
    if (!sourceHandle.startsWith(handlePrefix)) continue

    const innerId = sourceHandle.slice(handlePrefix.length)
    if (!innerId.startsWith(`${oldBlockId}-`)) continue

    const suffix = innerId.slice(oldBlockId.length + 1)
    return `${handlePrefix}${newBlockId}-${suffix}`
  }

  return sourceHandle
}
