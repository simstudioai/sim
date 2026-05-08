import type { SubBlockConfig } from '@/blocks/types'
import { getSubBlocksDependingOnChange } from '@/blocks/utils'

export interface DependentClear {
  subBlockId: string
  reason: string
}

export function getWorkflowSearchDependentClears(
  allSubBlocks: SubBlockConfig[],
  changedSubBlockId: string
): DependentClear[] {
  const clears: DependentClear[] = []
  const visited = new Set<string>([changedSubBlockId])
  const queue = [changedSubBlockId]

  while (queue.length > 0) {
    const currentSubBlockId = queue.shift()
    if (!currentSubBlockId) continue

    for (const subBlock of getSubBlocksDependingOnChange(allSubBlocks, currentSubBlockId)) {
      if (!subBlock.id || visited.has(subBlock.id)) continue
      visited.add(subBlock.id)
      clears.push({
        subBlockId: subBlock.id,
        reason: `${subBlock.id} depends on ${currentSubBlockId}`,
      })
      queue.push(subBlock.id)
    }
  }

  return clears
}
