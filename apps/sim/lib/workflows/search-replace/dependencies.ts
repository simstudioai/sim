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
  return getSubBlocksDependingOnChange(allSubBlocks, changedSubBlockId).map((subBlock) => ({
    subBlockId: subBlock.id,
    reason: `${subBlock.id} depends on ${changedSubBlockId}`,
  }))
}
