import type { SubBlockConfig } from '@/blocks/types'
import { getTrigger } from '@/triggers'

/**
 * Get subblocks for one or more triggers
 * - Single trigger: Returns subblocks directly from trigger definition
 * - Multiple triggers: Adds a dropdown selector and conditionally shows subblocks based on selection
 */
export function getTriggerSubBlocks(triggerIds: string | string[]): SubBlockConfig[] {
  const ids = Array.isArray(triggerIds) ? triggerIds : [triggerIds]

  if (ids.length === 0) return []

  if (ids.length === 1) {
    const triggerDef = getTrigger(ids[0])
    if (!triggerDef) {
      console.warn(`Trigger not found: ${ids[0]}`)
      return []
    }
    // Simply return the trigger's subblocks directly - no conversion needed!
    return triggerDef.subBlocks || []
  }

  const subBlocks: SubBlockConfig[] = []

  const triggerOptions = ids.map((id) => {
    const triggerDef = getTrigger(id)
    return {
      label: triggerDef?.name || id,
      id: id,
    }
  })

  subBlocks.push({
    id: 'selectedTriggerId',
    title: 'Trigger Type',
    type: 'dropdown',
    mode: 'trigger',
    options: triggerOptions,
    value: () => ids[0],
    required: true,
  })

  ids.forEach((triggerId) => {
    const triggerDef = getTrigger(triggerId)
    if (!triggerDef) {
      console.warn(`Trigger not found: ${triggerId}`)
      return
    }

    const triggerSubBlocks = triggerDef.subBlocks || []

    triggerSubBlocks.forEach((subBlock) => {
      subBlocks.push({
        ...subBlock,
        condition: {
          field: 'selectedTriggerId',
          value: triggerId,
        },
      })
    })
  })

  return subBlocks
}
