import type { SubBlockConfig } from '@/blocks/types'
import { getTrigger } from '@/triggers'
import { mapTriggerToSubBlocks } from '@/triggers/utils/trigger-to-subblock-mapper'

/**
 * Get subblocks for one or more triggers
 * - Single trigger: Returns subblocks for that trigger
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
    return mapTriggerToSubBlocks(triggerDef)
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

    const triggerSubBlocks = mapTriggerToSubBlocks(triggerDef)

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
