import { z } from 'zod'
import type { Logger } from '@/lib/logs/console-logger'

// Convert JSON schema to Zod schema (reused from extract route)
function jsonSchemaToZod(logger: Logger, jsonSchema: Record<string, any>): z.ZodTypeAny {
  if (!jsonSchema) {
    logger.error('Invalid schema: Schema is null or undefined')
    throw new Error('Invalid schema: Schema is required')
  }

  // Handle non-object schemas (strings, numbers, etc.)
  if (typeof jsonSchema !== 'object' || jsonSchema === null) {
    logger.warn('Schema is not an object, defaulting to any', { type: typeof jsonSchema })
    return z.any()
  }

  // Handle different schema types
  if (jsonSchema.type === 'object' && jsonSchema.properties) {
    const shape: Record<string, z.ZodTypeAny> = {}

    // Create a zod object for each property
    for (const [key, propSchema] of Object.entries(jsonSchema.properties)) {
      shape[key] = jsonSchemaToZod(logger, propSchema as Record<string, any>)

      // Add description if available
      if ((propSchema as Record<string, any>).description) {
        shape[key] = shape[key].describe((propSchema as Record<string, any>).description)
      }
    }

    // Create the base object
    let zodObject = z.object(shape)

    // Handle required fields if specified
    if (jsonSchema.required && Array.isArray(jsonSchema.required)) {
      // For each property that's not in required, make it optional
      for (const key of Object.keys(jsonSchema.properties)) {
        if (!jsonSchema.required.includes(key)) {
          shape[key] = shape[key].optional()
        }
      }

      // Recreate the object with the updated shape
      zodObject = z.object(shape)
    }

    return zodObject
  }
  if (jsonSchema.type === 'array' && jsonSchema.items) {
    const itemSchema = jsonSchemaToZod(logger, jsonSchema.items as Record<string, any>)
    let arraySchema = z.array(itemSchema)

    // Add description if available
    if (jsonSchema.description) {
      arraySchema = arraySchema.describe(jsonSchema.description)
    }

    return arraySchema
  }
  if (jsonSchema.type === 'string') {
    let stringSchema = z.string()

    // Add description if available
    if (jsonSchema.description) {
      stringSchema = stringSchema.describe(jsonSchema.description)
    }

    return stringSchema
  }
  if (jsonSchema.type === 'number') {
    let numberSchema = z.number()

    // Add description if available
    if (jsonSchema.description) {
      numberSchema = numberSchema.describe(jsonSchema.description)
    }

    return numberSchema
  }
  if (jsonSchema.type === 'boolean') {
    let boolSchema = z.boolean()

    // Add description if available
    if (jsonSchema.description) {
      boolSchema = boolSchema.describe(jsonSchema.description)
    }

    return boolSchema
  }
  if (jsonSchema.type === 'null') {
    return z.null()
  }
  if (jsonSchema.type === 'integer') {
    let intSchema = z.number().int()

    // Add description if available
    if (jsonSchema.description) {
      intSchema = intSchema.describe(jsonSchema.description)
    }

    return intSchema
  }
  // For unknown types, return any
  logger.warn('Unknown schema type, defaulting to any', { type: jsonSchema.type })
  return z.any()
}

// Helper function to ensure we have a ZodObject
export function ensureZodObject(logger: Logger, schema: Record<string, any>): z.ZodObject<any> {
  const zodSchema = jsonSchemaToZod(logger, schema)

  // If not already an object type, wrap it in an object
  if (schema.type !== 'object') {
    logger.warn('Schema is not an object type, wrapping in an object', {
      type: schema.type,
    })
    return z.object({ value: zodSchema })
  }

  // Safe cast since we know it's a ZodObject if type is 'object'
  return zodSchema as z.ZodObject<any>
}

export function normalizeUrl(url: string): string {
  // Normalize the URL - only add https:// if needed
  let normalizedUrl = url

  // Add https:// if no protocol is specified
  if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
    normalizedUrl = `https://${normalizedUrl}`
  }

  return normalizedUrl
}
