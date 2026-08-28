import type { Logger } from '@sim/logger'
import { isRecordLike } from '@sim/utils/object'
import { z } from 'zod'

function jsonSchemaToZod(logger: Logger, jsonSchema: Record<string, unknown>): z.ZodType {
  const type = jsonSchema.type
  if (type === 'object' && isRecordLike(jsonSchema.properties)) {
    const shape: Record<string, z.ZodType> = {}
    const required = new Set(
      Array.isArray(jsonSchema.required)
        ? jsonSchema.required.filter((value): value is string => typeof value === 'string')
        : []
    )
    for (const [key, property] of Object.entries(jsonSchema.properties)) {
      const propertySchema = isRecordLike(property) ? property : {}
      let fieldSchema = jsonSchemaToZod(logger, propertySchema)
      if (typeof propertySchema.description === 'string') {
        fieldSchema = fieldSchema.describe(propertySchema.description)
      }
      shape[key] = required.has(key) ? fieldSchema : fieldSchema.optional()
    }
    return z.object(shape)
  }
  if (type === 'array' && isRecordLike(jsonSchema.items)) {
    const arraySchema = z.array(jsonSchemaToZod(logger, jsonSchema.items))
    return typeof jsonSchema.description === 'string'
      ? arraySchema.describe(jsonSchema.description)
      : arraySchema
  }
  if (type === 'string') return z.string()
  if (type === 'number') return z.number()
  if (type === 'integer') return z.number().int()
  if (type === 'boolean') return z.boolean()
  if (type === 'null') return z.null()
  logger.warn('Unknown schema type, defaulting to any', { type })
  return z.any()
}

export function ensureZodObject(
  logger: Logger,
  schema: Record<string, unknown>
): z.ZodObject<Record<string, z.ZodType>> {
  const converted = jsonSchemaToZod(logger, schema)
  if (schema.type !== 'object') {
    logger.warn('Schema is not an object type, wrapping in an object', { type: schema.type })
    return z.object({ value: converted })
  }
  if (converted instanceof z.ZodObject) return converted
  return z.object({})
}

export function normalizeStagehandUrl(url: string): string {
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  return `https://${url.trim()}`
}
