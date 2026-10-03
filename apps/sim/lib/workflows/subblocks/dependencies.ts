import { buildCanonicalIndex } from '@/lib/workflows/subblocks/visibility'
import type { SubBlockConfig } from '@/blocks/types'

export interface DependentSubBlock {
  subBlockId: string
  reason: string
}

/** Flattens array and all/any dependency declarations into their referenced field IDs. */
export function getDependsOnFields(dependsOn: SubBlockConfig['dependsOn']): string[] {
  if (!dependsOn) return []
  if (Array.isArray(dependsOn)) return dependsOn
  return [...(dependsOn.all || []), ...(dependsOn.any || [])]
}

/** Finds direct dependents while treating canonical basic/advanced siblings as one field. */
export function getSubBlocksDependingOnChange(
  allSubBlocks: SubBlockConfig[],
  changedSubBlockId: string
): SubBlockConfig[] {
  const canonicalIndex = buildCanonicalIndex(allSubBlocks)
  const canonicalId = canonicalIndex.canonicalIdBySubBlockId[changedSubBlockId]
  const group = canonicalId ? canonicalIndex.groupsById[canonicalId] : undefined
  const changedFields = new Set<string>([changedSubBlockId])

  if (canonicalId) changedFields.add(canonicalId)
  if (group?.basicId) changedFields.add(group.basicId)
  for (const advancedId of group?.advancedIds || []) {
    changedFields.add(advancedId)
  }

  return allSubBlocks.filter((subBlock) =>
    getDependsOnFields(subBlock.dependsOn).some((field) => changedFields.has(field))
  )
}

/**
 * Returns every transitive `dependsOn` descendant of the changed subblocks.
 * Canonical basic/advanced siblings are treated as one logical field by the
 * shared block dependency resolver.
 */
export function getTransitiveSubBlockDependents(
  allSubBlocks: SubBlockConfig[],
  changedSubBlockIds: Iterable<string>
): DependentSubBlock[] {
  const dependents: DependentSubBlock[] = []
  const visited = new Set(changedSubBlockIds)
  const queue = [...visited]

  while (queue.length > 0) {
    const currentSubBlockId = queue.shift()
    if (!currentSubBlockId) continue

    for (const subBlock of getSubBlocksDependingOnChange(allSubBlocks, currentSubBlockId)) {
      if (!subBlock.id || visited.has(subBlock.id)) continue
      visited.add(subBlock.id)
      dependents.push({
        subBlockId: subBlock.id,
        reason: `${subBlock.id} depends on ${currentSubBlockId}`,
      })
      queue.push(subBlock.id)
    }
  }

  return dependents
}
