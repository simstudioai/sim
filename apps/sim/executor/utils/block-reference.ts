import { USER_FILE_ACCESSIBLE_PROPERTIES } from '@/lib/workflows/types'
import { normalizeName } from '@/executor/constants'
import { navigatePath } from '@/executor/variables/resolvers/reference'

export type OutputSchema = Record<string, { type?: string; description?: string } | unknown>

export interface BlockReferenceContext {
  blockNameMapping: Record<string, string>
  blockData: Record<string, unknown>
  blockOutputSchemas?: Record<string, OutputSchema>
}

export interface BlockReferenceResult {
  value: unknown
  blockId: string
}

export class InvalidFieldError extends Error {
  constructor(
    public readonly blockName: string,
    public readonly fieldPath: string,
    public readonly availableFields: string[]
  ) {
    super(
      `"${fieldPath}" doesn't exist on block "${blockName}". ` +
        `Available fields: ${availableFields.length > 0 ? availableFields.join(', ') : 'none'}`
    )
    this.name = 'InvalidFieldError'
  }
}

function isFileType(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const typed = value as { type?: string }
  return typed.type === 'file' || typed.type === 'file[]'
}

function isArrayType(value: unknown): value is { type: 'array'; items?: unknown } {
  if (typeof value !== 'object' || value === null) return false
  return (value as { type?: string }).type === 'array'
}

function getArrayItems(schema: unknown): unknown {
  if (typeof schema !== 'object' || schema === null) return undefined
  return (schema as { items?: unknown }).items
}

function getProperties(schema: unknown): Record<string, unknown> | undefined {
  if (typeof schema !== 'object' || schema === null) return undefined
  const props = (schema as { properties?: unknown }).properties
  return typeof props === 'object' && props !== null
    ? (props as Record<string, unknown>)
    : undefined
}

function getSchemaType(schema: unknown): string | null {
  if (typeof schema !== 'object' || schema === null) return null
  const rawType = (schema as { type?: unknown }).type
  return typeof rawType === 'string' ? rawType.toLowerCase() : null
}

function isDynamicSchemaNode(schema: unknown): boolean {
  const schemaType = getSchemaType(schema)
  if (!schemaType) return false
  if (schemaType === 'any' || schemaType === 'json') {
    return true
  }
  if (schemaType === 'object' && !getProperties(schema)) {
    return true
  }
  return false
}

function lookupField(schema: unknown, fieldName: string): unknown | undefined {
  if (typeof schema !== 'object' || schema === null) return undefined
  const typed = schema as Record<string, unknown>

  if (fieldName in typed) {
    return typed[fieldName]
  }

  const props = getProperties(schema)
  if (props && fieldName in props) {
    return props[fieldName]
  }

  return undefined
}

function isPathInSchema(schema: OutputSchema | undefined, pathParts: string[]): boolean {
  if (!schema || pathParts.length === 0) {
    return true
  }

  let current: unknown = schema

  for (let i = 0; i < pathParts.length; i++) {
    const part = pathParts[i]

    if (current === null || current === undefined) {
      return false
    }

    if (isDynamicSchemaNode(current)) {
      // Dynamic schema node (json/any/object-without-properties):
      // allow deeper traversal without strict field validation.
      return true
    }

    if (/^\d+$/.test(part)) {
      if (isFileType(current)) {
        const nextPart = pathParts[i + 1]
        return (
          !nextPart ||
          USER_FILE_ACCESSIBLE_PROPERTIES.includes(
            nextPart as (typeof USER_FILE_ACCESSIBLE_PROPERTIES)[number]
          )
        )
      }
      if (isArrayType(current)) {
        const items = getArrayItems(current)
        if (items === undefined) {
          // Arrays without declared item schema are treated as dynamic.
          return true
        }
        current = items
      }
      continue
    }

    const arrayMatch = part.match(/^([^[]+)\[(\d+)\]$/)
    if (arrayMatch) {
      const [, prop] = arrayMatch
      const fieldDef = lookupField(current, prop)
      if (!fieldDef) return false

      if (isFileType(fieldDef)) {
        const nextPart = pathParts[i + 1]
        return (
          !nextPart ||
          USER_FILE_ACCESSIBLE_PROPERTIES.includes(
            nextPart as (typeof USER_FILE_ACCESSIBLE_PROPERTIES)[number]
          )
        )
      }

      current = isArrayType(fieldDef) ? getArrayItems(fieldDef) : fieldDef
      if (current === undefined) {
        // Array/object without explicit shape after this segment.
        return true
      }
      continue
    }

    if (
      isFileType(current) &&
      USER_FILE_ACCESSIBLE_PROPERTIES.includes(
        part as (typeof USER_FILE_ACCESSIBLE_PROPERTIES)[number]
      )
    ) {
      return true
    }

    const fieldDef = lookupField(current, part)
    if (fieldDef !== undefined) {
      if (isFileType(fieldDef)) {
        const nextPart = pathParts[i + 1]
        if (!nextPart) return true
        if (/^\d+$/.test(nextPart)) {
          const afterIndex = pathParts[i + 2]
          return (
            !afterIndex ||
            USER_FILE_ACCESSIBLE_PROPERTIES.includes(
              afterIndex as (typeof USER_FILE_ACCESSIBLE_PROPERTIES)[number]
            )
          )
        }
        return USER_FILE_ACCESSIBLE_PROPERTIES.includes(
          nextPart as (typeof USER_FILE_ACCESSIBLE_PROPERTIES)[number]
        )
      }
      current = fieldDef
      continue
    }

    if (isArrayType(current)) {
      const items = getArrayItems(current)
      const itemField = lookupField(items, part)
      if (itemField !== undefined) {
        current = itemField
        continue
      }
    }

    return false
  }

  return true
}

function getSchemaFieldNames(schema: OutputSchema | undefined): string[] {
  if (!schema) return []
  return Object.keys(schema)
}

export function resolveBlockReference(
  blockName: string,
  pathParts: string[],
  context: BlockReferenceContext
): BlockReferenceResult | undefined {
  const normalizedName = normalizeName(blockName)
  const blockId = context.blockNameMapping[normalizedName]

  if (!blockId) {
    return undefined
  }

  const blockOutput = context.blockData[blockId]
  const schema = context.blockOutputSchemas?.[blockId]

  if (blockOutput === undefined) {
    if (schema && pathParts.length > 0) {
      if (!isPathInSchema(schema, pathParts)) {
        throw new InvalidFieldError(blockName, pathParts.join('.'), getSchemaFieldNames(schema))
      }
    }
    return { value: undefined, blockId }
  }

  if (pathParts.length === 0) {
    return { value: blockOutput, blockId }
  }

  const value = navigatePath(blockOutput, pathParts)

  if (value === undefined && schema) {
    if (!isPathInSchema(schema, pathParts)) {
      throw new InvalidFieldError(blockName, pathParts.join('.'), getSchemaFieldNames(schema))
    }
  }

  return { value, blockId }
}
