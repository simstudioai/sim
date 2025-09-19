import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('WorkflowReferenceUtils')

/**
 * Recursively update block ID references in a value using a provided ID mapping.
 * Handles strings, arrays, and objects. Strings are searched for `"<oldId."` and `"%oldId."` patterns.
 */
export function updateBlockReferences(
  value: any,
  blockIdMapping: Map<string, string>,
  contextId?: string
): any {
  try {
    if (typeof value === 'string') {
      let result = value
      for (const [oldId, newId] of blockIdMapping.entries()) {
        if (result.includes(oldId)) {
          result = result
            .replaceAll(`<${oldId}.`, `<${newId}.`)
            .replaceAll(`%${oldId}.`, `%${newId}.`)
        }
      }
      return result
    }

    if (Array.isArray(value)) {
      return value.map((item) => updateBlockReferences(item, blockIdMapping, contextId))
    }

    if (value && typeof value === 'object') {
      const result: Record<string, any> = {}
      for (const [key, val] of Object.entries(value)) {
        result[key] = updateBlockReferences(val, blockIdMapping, contextId)
      }
      return result
    }

    return value
  } catch (err) {
    logger.warn('Failed to update block references', {
      contextId,
      error: err instanceof Error ? err.message : String(err),
    })
    return value
  }
}
