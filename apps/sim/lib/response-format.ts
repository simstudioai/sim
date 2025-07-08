import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('ResponseFormatUtils')

// Type definitions for component data structures
export interface Field {
  name: string
  type: string
  description?: string
}

/**
 * Helper function to extract fields from JSON Schema
 * Handles both legacy format with fields array and new JSON Schema format
 */
export function extractFieldsFromSchema(schema: any): Field[] {
  if (!schema || typeof schema !== 'object') {
    return []
  }

  // Handle legacy format with fields array
  if (Array.isArray(schema.fields)) {
    return schema.fields
  }

  // Handle new JSON Schema format
  const schemaObj = schema.schema || schema
  if (!schemaObj || !schemaObj.properties || typeof schemaObj.properties !== 'object') {
    return []
  }

  // Extract fields from schema properties
  return Object.entries(schemaObj.properties).map(([name, prop]: [string, any]) => {
    // Handle array format like ['string', 'array']
    if (Array.isArray(prop)) {
      return {
        name,
        type: prop.includes('array') ? 'array' : prop[0] || 'string',
        description: undefined,
      }
    }

    // Handle object format like { type: 'string', description: '...' }
    return {
      name,
      type: prop.type || 'string',
      description: prop.description,
    }
  })
}

/**
 * Helper function to safely parse response format
 * Handles both string and object formats
 */
export function parseResponseFormatSafely(responseFormatValue: any, blockId: string): any {
  if (!responseFormatValue) {
    return null
  }

  try {
    if (typeof responseFormatValue === 'string') {
      return JSON.parse(responseFormatValue)
    }
    return responseFormatValue
  } catch (error) {
    logger.warn(`Failed to parse response format for block ${blockId}:`, error)
    return null
  }
}

/**
 * Extract field values from a parsed JSON object based on selected output paths
 * Used for both workspace and chat client field extraction
 */
export function extractFieldValues(
  parsedContent: any,
  selectedOutputIds: string[],
  blockId: string
): Record<string, any> {
  const extractedValues: Record<string, any> = {}

  for (const outputId of selectedOutputIds) {
    const blockIdForOutput = extractBlockIdFromOutputId(outputId)

    if (blockIdForOutput !== blockId) {
      continue
    }

    const path = extractPathFromOutputId(outputId, blockIdForOutput)

    if (path) {
      const pathParts = path.split('.')
      let current = parsedContent

      for (const part of pathParts) {
        if (current && typeof current === 'object' && part in current) {
          current = current[part]
        } else {
          current = undefined
          break
        }
      }

      if (current !== undefined) {
        extractedValues[path] = current
      }
    }
  }

  return extractedValues
}

/**
 * Format extracted field values for display
 * Returns formatted string representation of field values
 */
export function formatFieldValues(extractedValues: Record<string, any>): string {
  const formattedValues: string[] = []

  for (const [fieldName, value] of Object.entries(extractedValues)) {
    const formattedValue = typeof value === 'string' ? value : JSON.stringify(value)
    formattedValues.push(formattedValue)
  }

  return formattedValues.join('\n')
}

/**
 * Extract block ID from output ID
 * Handles both formats: "blockId" and "blockId_path" or "blockId.path"
 */
export function extractBlockIdFromOutputId(outputId: string): string {
  return outputId.includes('_') ? outputId.split('_')[0] : outputId.split('.')[0]
}

/**
 * Extract path from output ID after the block ID
 */
export function extractPathFromOutputId(outputId: string, blockId: string): string {
  return outputId.substring(blockId.length + 1)
}

/**
 * Parse JSON content from output safely
 * Handles both string and object formats with proper error handling
 */
export function parseOutputContentSafely(output: any): any {
  if (!output?.content) {
    return output
  }

  if (typeof output.content === 'string') {
    try {
      return JSON.parse(output.content)
    } catch (e) {
      // Fallback to original structure if parsing fails
      return output
    }
  }

  return output
}

/**
 * Check if a set of output IDs contains response format selections for a specific block
 */
export function hasResponseFormatSelection(selectedOutputIds: string[], blockId: string): boolean {
  return selectedOutputIds.some((outputId) => {
    const blockIdForOutput = extractBlockIdFromOutputId(outputId)
    return blockIdForOutput === blockId && outputId.includes('_')
  })
}

/**
 * Get selected field names for a specific block from output IDs
 */
export function getSelectedFieldNames(selectedOutputIds: string[], blockId: string): string[] {
  return selectedOutputIds
    .filter((outputId) => {
      const blockIdForOutput = extractBlockIdFromOutputId(outputId)
      return blockIdForOutput === blockId && outputId.includes('_')
    })
    .map((outputId) => extractPathFromOutputId(outputId, blockId))
}
