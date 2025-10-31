import { createLogger } from '@/lib/logs/console/logger'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { getTrigger, isTriggerValid } from '@/triggers'
import { SYSTEM_SUBBLOCK_IDS } from '@/triggers/consts'

const logger = createLogger('useTriggerConfigAggregation')

/**
 * Maps old trigger config field names to new subblock IDs for backward compatibility
 */
function mapOldFieldNameToNewSubBlockId(oldFieldName: string): string {
  const fieldMapping: Record<string, string> = {
    credentialId: 'triggerCredentials',
    includeCellValuesInFieldIds: 'includeCellValues',
  }
  return fieldMapping[oldFieldName] || oldFieldName
}

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

  if (!isTriggerValid(triggerId)) {
    logger.warn(`Trigger definition not found for ID: ${triggerId}`)
    return null
  }

  const triggerDef = getTrigger(triggerId)

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

  if (!isTriggerValid(triggerId)) {
    return
  }

  const triggerDef = getTrigger(triggerId)

  const subBlockStore = useSubBlockStore.getState()

  triggerDef.subBlocks
    .filter((sb) => sb.mode === 'trigger' && !SYSTEM_SUBBLOCK_IDS.includes(sb.id))
    .forEach((subBlock) => {
      let configValue: any

      if (subBlock.id in triggerConfig) {
        configValue = triggerConfig[subBlock.id]
      } else {
        for (const [oldFieldName, value] of Object.entries(triggerConfig)) {
          const mappedFieldName = mapOldFieldNameToNewSubBlockId(oldFieldName)
          if (mappedFieldName === subBlock.id) {
            configValue = value
            break
          }
        }
      }

      if (configValue !== undefined) {
        const currentValue = subBlockStore.getValue(blockId, subBlock.id)

        let normalizedValue = configValue
        // Handle array fields - normalize strings to arrays, preserve arrays as-is
        if (subBlock.id === 'labelIds' || subBlock.id === 'folderIds') {
          if (typeof configValue === 'string' && configValue.trim() !== '') {
            try {
              normalizedValue = JSON.parse(configValue)
            } catch {
              normalizedValue = [configValue]
            }
          } else if (
            !Array.isArray(configValue) &&
            configValue !== null &&
            configValue !== undefined
          ) {
            // If it's not already an array and not null/undefined, wrap it
            normalizedValue = [configValue]
          }
          // If it's already an array or null/undefined, use as-is
        }

        if (currentValue === null || currentValue === undefined || currentValue === '') {
          subBlockStore.setValue(blockId, subBlock.id, normalizedValue)
        }
      }
    })
}
