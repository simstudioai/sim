import { USER_FILE_ACCESSIBLE_PROPERTIES } from '@/lib/workflows/types'
import { normalizeName } from '@/executor/constants'
import { navigatePath } from '@/executor/variables/resolvers/reference'

/**
 * A single schema node encountered while walking an `OutputSchema`. Captures
 * only the fields this module inspects — not a full schema type.
 */
interface SchemaNode {
  type?: string
  description?: string
  properties?: unknown
  items?: unknown
}

export type OutputSchema = Record<string, SchemaNode | unknown>

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

function asSchemaNode(value: unknown): SchemaNode | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  return value as SchemaNode
}

function isFileType(value: unknown): boolean {
  const node = asSchemaNode(value)
  return node?.type === 'file' || node?.type === 'file[]'
}

function isArrayType(value: unknown): value is { type: 'array'; items?: unknown } {
  return asSchemaNode(value)?.type === 'array'
}

function getArrayItems(schema: unknown): unknown {
  return asSchemaNode(schema)?.items
}

function getProperties(schema: unknown): Record<string, unknown> | undefined {
  const props = asSchemaNode(schema)?.properties
  return typeof props === 'object' && props !== null
    ? (props as Record<string, unknown>)
    : undefined
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

function isOpaqueSchemaNode(value: unknown): boolean {
  const node = asSchemaNode(value)
  if (!node) return false
  // A schema node whose nested shape isn't enumerated. Any path beneath it
  // is accepted because there's no declared structure to validate against.
  // `object` / `json` with declared `properties` are walked via lookupField.
  if (node.type === 'any') return true
  if ((node.type === 'json' || node.type === 'object') && node.properties === undefined) {
    return true
  }
  return false
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

    if (isOpaqueSchemaNode(current)) {
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
        current = getArrayItems(current)
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

  // When the block has not produced any output (e.g. it lives on a branched
  // path that wasn't taken), resolve the reference to undefined without
  // validating against the declared schema. Callers map this to an empty
  // value so that references to skipped blocks don't fail the workflow.
  if (blockOutput === undefined) {
    return { value: undefined, blockId }
  }

  if (pathParts.length === 0) {
    return { value: blockOutput, blockId }
  }

  const value = navigatePath(blockOutput, pathParts)

  const schema = context.blockOutputSchemas?.[blockId]
  if (value === undefined && schema) {
    if (!isPathInSchema(schema, pathParts)) {
      throw new InvalidFieldError(blockName, pathParts.join('.'), getSchemaFieldNames(schema))
    }
  }

  return { value, blockId }
}
