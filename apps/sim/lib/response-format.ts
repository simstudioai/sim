import { createLogger } from '@/lib/logs/console/logger'

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
  selectedOutputs: string[],
  blockId: string
): Record<string, any> {
  const extractedValues: Record<string, any> = {}

  for (const outputId of selectedOutputs) {
    const blockIdForOutput = extractBlockIdFromOutputId(outputId)

    if (blockIdForOutput !== blockId) {
      continue
    }

    const path = extractPathFromOutputId(outputId, blockIdForOutput)

    if (path) {
      const current = traverseObjectPathInternal(parsedContent, path)
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
export function hasResponseFormatSelection(selectedOutputs: string[], blockId: string): boolean {
  return selectedOutputs.some((outputId) => {
    const blockIdForOutput = extractBlockIdFromOutputId(outputId)
    return blockIdForOutput === blockId && outputId.includes('_')
  })
}

/**
 * Get selected field names for a specific block from output IDs
 */
export function getSelectedFieldNames(selectedOutputs: string[], blockId: string): string[] {
  return selectedOutputs
    .filter((outputId) => {
      const blockIdForOutput = extractBlockIdFromOutputId(outputId)
      return blockIdForOutput === blockId && outputId.includes('_')
    })
    .map((outputId) => extractPathFromOutputId(outputId, blockId))
}

/**
 * Internal helper to traverse an object path without parsing
 * @param obj The object to traverse
 * @param path The dot-separated path (e.g., "result.data.value")
 * @returns The value at the path, or undefined if path doesn't exist
 */
function traverseObjectPathInternal(obj: any, path: string): any {
  if (!path) return obj

  let current = obj
  const parts = path.split('.')

  for (const part of parts) {
    if (current?.[part] !== undefined) {
      current = current[part]
    } else {
      return undefined
    }
  }

  return current
}

/**
 * Traverses an object path safely, returning undefined if any part doesn't exist
 * Automatically handles parsing of output content if needed
 * @param obj The object to traverse (may contain unparsed content)
 * @param path The dot-separated path (e.g., "result.data.value")
 * @returns The value at the path, or undefined if path doesn't exist
 */
export function traverseObjectPath(obj: any, path: string): any {
  const parsed = parseOutputContentSafely(obj)
  return traverseObjectPathInternal(parsed, path)
}

/**
 * Resolve a $ref in the schema by traversing the root object.
 * Supports only internal #/ refs; logs/warns on invalid/unsupported.
 * Recursively resolves if target has $ref/allOf.
 * @param ref The reference string (e.g., "#/components/schemas/Input")
 * @param root The root schema object for resolving references
 * @returns The resolved schema object
 */
function resolveRef(ref: string, root: any): any {
  if (!ref.startsWith('#/')) {
    const errMsg = `Unsupported ref: ${ref}`
    logger.warn(errMsg)
    throw new Error(errMsg)
  }

  // Convert #/components/schemas/foo to components.schemas.foo
  const path = ref.slice(2).replace(/\//g, '.')
  const target = traverseObjectPathInternal(root, path)

  if (target === undefined) {
    const errMsg = `Invalid ref path: ${ref}`
    logger.error(errMsg)
    throw new Error(errMsg)
  }

  // Recursively dereference the target
  return dereferenceSchema(target, root)
}

/**
 * Basic dereference for a schema node: resolve $ref/allOf recursively.
 * Merges allOf by combining properties/required; handles arrays/objects.
 * Uses memo to avoid cycles (simple Map).
 *
 * This is particularly useful for Replicate's OpenAPI schemas which use
 * $ref to reference enum types and allOf to compose schemas.
 *
 * @param schema The schema node to dereference
 * @param root The root schema object (for resolving $ref)
 * @param memo Memoization map to prevent infinite recursion
 * @returns Fully dereferenced schema
 */
export function dereferenceSchema(
  schema: any,
  root: any,
  memo: Map<any, any> = new Map()
): any {
  // Handle primitives and arrays
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) {
    return schema
  }

  // Check memo to prevent cycles
  if (memo.has(schema)) {
    return memo.get(schema)
  }

  // Create result object and memoize immediately
  const result: any = {}
  memo.set(schema, result)

  // Handle $ref
  if (schema.$ref) {
    const resolved = resolveRef(schema.$ref, root)
    // Copy resolved properties to result
    Object.assign(result, resolved)
    return result
  }

  // Handle allOf
  if (schema.allOf) {
    let merged: any = { properties: {}, required: [] }

    for (const sub of schema.allOf) {
      const derefSub = dereferenceSchema(sub, root, memo)

      // Merge top-level properties
      Object.assign(merged, derefSub)

      // Merge properties objects
      if (derefSub.properties) {
        merged.properties = { ...merged.properties, ...derefSub.properties }
      }

      // Merge required arrays (deduplicate)
      if (derefSub.required) {
        merged.required = [...new Set([...(merged.required || []), ...derefSub.required])]
      }
    }

    // Apply merged allOf result first, then overlay original properties to preserve them
    // This ensures default, description, x-order from the original schema are not lost
    Object.assign(result, merged, schema)

    // Clean up: Remove allOf after processing
    delete result.allOf
  } else {
    // Copy schema to result
    Object.assign(result, schema)
  }

  // Recursively dereference nested objects
  for (const key in result) {
    if (result[key] && typeof result[key] === 'object') {
      result[key] = dereferenceSchema(result[key], root, memo)
    }
  }

  return result
}

