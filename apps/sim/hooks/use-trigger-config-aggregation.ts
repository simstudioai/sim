import { createLogger } from '@/lib/logs/console/logger'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { getTrigger } from '@/triggers'
import { SYSTEM_SUBBLOCK_IDS } from '@/triggers/consts'

const logger = createLogger('useTriggerConfigAggregation')

/**
 * Aggregates individual trigger field subblocks into a triggerConfig object.
 * This is called on-demand when saving, not continuously.
 *
 * @param blockId - The block ID that has the trigger fields
 * @param triggerId - The trigger ID to get the config fields from
 * @returns The aggregated config object, or null if no valid config
 */

export function useTriggerConfigAggregation(
  blockId: string,
  triggerId: string | undefined
): Record<string, any> | null {
  if (!triggerId || !blockId) {
    return null
  }

  const triggerDef = getTrigger(triggerId)
  if (!triggerDef) {
    logger.warn(`Trigger definition not found for ID: ${triggerId}`)
    return null
  }

  const subBlockStore = useSubBlockStore.getState()

  const aggregatedConfig: Record<string, any> = {}
  let hasAnyValue = false

  triggerDef.subBlocks
    .filter((sb) => sb.mode === 'trigger' && !SYSTEM_SUBBLOCK_IDS.includes(sb.id))
    .forEach((subBlock) => {
      const fieldValue = subBlockStore.getValue(blockId, subBlock.id)

      let valueToUse = fieldValue
      if (
        (fieldValue === null || fieldValue === undefined || fieldValue === '') &&
        subBlock.required &&
        subBlock.defaultValue !== undefined
      ) {
        valueToUse = subBlock.defaultValue
      }

      if (valueToUse !== null && valueToUse !== undefined && valueToUse !== '') {
        aggregatedConfig[subBlock.id] = valueToUse
        hasAnyValue = true
      }
    })

  if (!hasAnyValue) {
    return null
  }

  logger.debug('Aggregated trigger config fields', {
    blockId,
    triggerId,
    aggregatedConfig,
  })

  return aggregatedConfig
}

/**
 * Populates individual trigger field subblocks from a triggerConfig object.
 * Used for backward compatibility when loading existing workflows.
 *
 * @param blockId - The block ID to populate fields for
 * @param triggerConfig - The trigger config object to extract fields from
 * @param triggerId - The trigger ID to get the field definitions
 */
export function populateTriggerFieldsFromConfig(
  blockId: string,
  triggerConfig: Record<string, any> | null | undefined,
  triggerId: string | undefined
) {
  if (!triggerConfig || !triggerId || !blockId) {
    return
  }

  const triggerDef = getTrigger(triggerId)
  if (!triggerDef) {
    return
  }

  const subBlockStore = useSubBlockStore.getState()

  triggerDef.subBlocks
    .filter((sb) => sb.mode === 'trigger' && !SYSTEM_SUBBLOCK_IDS.includes(sb.id))
    .forEach((subBlock) => {
      if (subBlock.id in triggerConfig) {
        const currentValue = subBlockStore.getValue(blockId, subBlock.id)

        if (currentValue === null || currentValue === undefined || currentValue === '') {
          subBlockStore.setValue(blockId, subBlock.id, triggerConfig[subBlock.id])
        }
      }
    })
}
