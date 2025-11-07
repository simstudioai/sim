import { formatParameterLabel } from '@/tools/params'

/**
 * Represents an OpenAPI/JSON Schema property
 */
export interface OpenApiProperty {
  type: 'string' | 'integer' | 'number' | 'boolean' | 'array' | 'object'
  title?: string
  description?: string
  enum?: any[]
  minimum?: number
  maximum?: number
  multipleOf?: number
  minLength?: number
  maxLength?: number
  default?: any
  format?: string
  'x-order'?: number
}

/**
 * Simplified field configuration for rendering dynamic inputs
 */
export interface FieldConfig {
  name: string
  title: string
  description?: string
  required: boolean
  type: 'string' | 'integer' | 'number' | 'boolean' | 'array' | 'object'
  enum?: any[]
  minimum?: number
  maximum?: number
  multipleOf?: number
  default?: any
  format?: string
  order: number
}

/**
 * Parse an OpenAPI/JSON Schema into field configurations.
 *
 * This function extracts properties from an OpenAPI schema and converts them
 * into a simplified format suitable for rendering dynamic form inputs.
 *
 * **Supports**:
 * - All JSON Schema primitive types
 * - Enums for dropdown options
 * - Min/max for sliders
 * - Default values
 * - Required field detection
 * - Field ordering via x-order property
 *
 * **Use Cases**:
 * - Replicate block (OpenAPI model schemas)
 * - Future Hugging Face integration
 * - Future AWS Bedrock integration
 * - Any OpenAPI-based AI model integration
 *
 * @param schema OpenAPI/JSON Schema object with properties and required fields
 * @returns Array of field configurations sorted by x-order
 *
 * @example
 * ```typescript
 * const schema = {
 *   properties: {
 *     prompt: { type: 'string', description: 'Text prompt', 'x-order': 0 },
 *     num_outputs: { type: 'integer', minimum: 1, maximum: 4, default: 1, 'x-order': 1 }
 *   },
 *   required: ['prompt']
 * }
 *
 * const fields = parseOpenApiSchema(schema)
 * // [
 * //   { name: 'prompt', type: 'string', required: true, order: 0, ... },
 * //   { name: 'num_outputs', type: 'integer', minimum: 1, maximum: 4, order: 1, ... }
 * // ]
 * ```
 */
export function parseOpenApiSchema(schema: any): FieldConfig[] {
  if (!schema?.properties) {
    return []
  }

  const properties = schema.properties
  const required = schema.required || []

  // Convert to field configs and sort by x-order
  const fields = Object.entries(properties).map(([name, prop]: [string, any]) => ({
    name,
    title: formatParameterLabel(prop.title || name),
    description: prop.description,
    required: required.includes(name),
    type: prop.type as FieldConfig['type'],
    enum: prop.enum,
    minimum: prop.minimum,
    maximum: prop.maximum,
    multipleOf: prop.multipleOf,
    default: prop.default,
    format: prop.format,
    order: prop['x-order'] !== undefined ? prop['x-order'] : 999,
  }))

  // Sort by order property
  return fields.sort((a, b) => a.order - b.order)
}

/**
 * Infer the appropriate UI input type for an OpenAPI property.
 *
 * Mapping rules:
 * - boolean → 'switch'
 * - enum → 'dropdown'
 * - integer/number with min/max → 'slider'
 * - integer/number without bounds → 'short-input'
 * - string → 'long-input' (good for prompts) or 'short-input' based on preference
 * - array/object → 'code'
 *
 * @param field Field configuration
 * @param options Mapping preferences
 * @returns UI input type identifier
 */
export function inferInputType(
  field: FieldConfig,
  options?: {
    preferLongInput?: boolean // Default true for Replicate (prompts)
  }
): 'switch' | 'dropdown' | 'slider' | 'short-input' | 'long-input' | 'code' {
  const { preferLongInput = true } = options || {}

  if (field.enum && Array.isArray(field.enum)) {
    return 'dropdown'
  }

  if (field.type === 'boolean') {
    return 'switch'
  }

  if (field.type === 'integer' || field.type === 'number') {
    if (field.minimum !== undefined && field.maximum !== undefined) {
      return 'slider'
    }
    return 'short-input'
  }

  if (field.type === 'string') {
    if (field.format === 'uri' || field.format === 'url' || field.format === 'date-time') {
      return 'short-input'
    }
    return preferLongInput ? 'long-input' : 'short-input'
  }

  if (field.type === 'array' || field.type === 'object') {
    return 'code'
  }

  return 'short-input'
}

/**
 * Detect if a field should be rendered as a password input.
 */
export function isPasswordField(fieldName: string, field: FieldConfig): boolean {
  if (field.format === 'password') {
    return true
  }

  const lowerName = fieldName.toLowerCase()
  return (
    lowerName.includes('password') ||
    lowerName.includes('secret') ||
    lowerName.includes('token')
  )
}

/**
 * Coerce a value to the correct type based on field configuration.
 *
 * Handles type conversion from strings (common from JSON parsing, preview mode)
 * to the proper types expected by APIs (integer, number, boolean).
 *
 * **Rules**:
 * - Empty/null/undefined → returns undefined (to be filtered out)
 * - String numbers → parsed to integer or float based on field type
 * - String booleans ("true"/"false") → boolean
 * - Already correct type → returned as-is
 * - Empty objects/arrays → returns undefined
 *
 * **Use Cases**:
 * - Replicate API strict type validation
 * - MCP tool argument formatting
 * - Any OpenAPI integration requiring typed parameters
 *
 * @param value Raw value (may be string, number, boolean, object, etc.)
 * @param field Field configuration specifying expected type
 * @returns Coerced value or undefined if empty/invalid
 *
 * @example
 * ```typescript
 * coerceValue("5", { type: 'integer', ... })  // → 5 (integer)
 * coerceValue("5.5", { type: 'number', ... }) // → 5.5 (float)
 * coerceValue("true", { type: 'boolean', ... }) // → true (boolean)
 * coerceValue("", { type: 'string', ... })    // → undefined (empty)
 * coerceValue("hello", { type: 'string', ... }) // → "hello" (string)
 * ```
 */
export function coerceValue(value: any, field: FieldConfig): any {
  // Check if value is meaningful (not empty/null/undefined)
  if (value === null || value === undefined) return undefined
  if (typeof value === 'string' && value.trim() === '') return undefined
  if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) {
    return undefined
  }
  if (Array.isArray(value) && value.length === 0) return undefined

  // If value is already the correct type, return as-is
  if (field.type === 'boolean' && typeof value === 'boolean') return value
  if ((field.type === 'integer' || field.type === 'number') && typeof value === 'number') {
    return field.type === 'integer' ? Math.round(value) : value
  }
  if (field.type === 'string' && typeof value === 'string') return value.trim()
  if (field.type === 'array' && Array.isArray(value)) return value
  if (field.type === 'object' && typeof value === 'object' && !Array.isArray(value)) return value

  // Type coercion for string values
  if (typeof value === 'string') {
    const trimmed = value.trim()

    // Boolean coercion
    if (field.type === 'boolean') {
      if (trimmed === 'true') return true
      if (trimmed === 'false') return false
      return undefined // Invalid boolean string
    }

    // Number coercion
    if (field.type === 'integer' || field.type === 'number') {
      const asNumber = Number(trimmed)
      if (Number.isNaN(asNumber)) return undefined // Invalid number string

      if (field.type === 'integer') {
        // For integers, parse as int (handles "5.0" → 5, "5.9" → 5)
        return Number.parseInt(trimmed, 10)
      }
      // For floats, return the parsed number
      return asNumber
    }

    // String type - return trimmed
    if (field.type === 'string') return trimmed

    // Array/Object - try JSON parsing
    if (field.type === 'array' || field.type === 'object') {
      try {
        return JSON.parse(trimmed)
      } catch {
        return undefined // Invalid JSON
      }
    }
  }

  // Fallback: return value as-is
  return value
}

/**
 * Validate a field value against its configuration.
 *
 * Checks:
 * - Required fields are not empty
 * - Numbers are within min/max bounds
 * - Enums match allowed values
 * - Format constraints (basic validation for URLs, dates)
 *
 * @param value Field value (after coercion)
 * @param field Field configuration
 * @returns Validation result with error message if invalid
 *
 * @example
 * ```typescript
 * validateField(undefined, { required: true, ... })
 * // → { valid: false, error: "This field is required" }
 *
 * validateField(150, { type: 'integer', minimum: 1, maximum: 100, ... })
 * // → { valid: false, error: "Value must be between 1 and 100" }
 *
 * validateField(50, { type: 'integer', minimum: 1, maximum: 100, ... })
 * // → { valid: true }
 * ```
 */
export function validateField(
  value: any,
  field: FieldConfig
): { valid: boolean; error?: string } {
  // Required check
  if (field.required && (value === undefined || value === null || value === '')) {
    return { valid: false, error: 'This field is required' }
  }

  // If value is empty and not required, it's valid
  if (value === undefined || value === null || value === '') {
    return { valid: true }
  }

  // Enum validation
  if (field.enum && Array.isArray(field.enum)) {
    if (!field.enum.includes(value)) {
      return { valid: false, error: `Must be one of: ${field.enum.join(', ')}` }
    }
  }

  // Number range validation
  if (field.type === 'integer' || field.type === 'number') {
    const numValue = typeof value === 'number' ? value : Number(value)

    if (Number.isNaN(numValue)) {
      return { valid: false, error: 'Must be a valid number' }
    }

    if (field.minimum !== undefined && numValue < field.minimum) {
      return {
        valid: false,
        error: `Value must be at least ${field.minimum}`,
      }
    }

    if (field.maximum !== undefined && numValue > field.maximum) {
      return {
        valid: false,
        error: `Value must be at most ${field.maximum}`,
      }
    }
  }

  // String format validation (basic)
  if (field.type === 'string' && field.format) {
    const strValue = String(value)

    if (field.format === 'uri' || field.format === 'url') {
      try {
        new URL(strValue)
      } catch {
        return { valid: false, error: 'Must be a valid URL' }
      }
    }

    if (field.format === 'email') {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!emailRegex.test(strValue)) {
        return { valid: false, error: 'Must be a valid email address' }
      }
    }
  }

  return { valid: true }
}
