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

function isPathInSchema(schema: OutputSchema | undefined, pathParts: string[]): boolean {
  if (!schema || pathParts.length === 0) {
    return true
  }

  const FILE_PROPERTIES = ['name', 'type', 'size', 'url', 'base64', 'mimeType']
  const isFileType = (value: unknown): boolean => {
    if (typeof value !== 'object' || value === null) return false
    const typed = value as { type?: string }
    return typed.type === 'file[]' || typed.type === 'files'
  }

  let current: unknown = schema

  for (let i = 0; i < pathParts.length; i++) {
    const part = pathParts[i]

    if (current === null || current === undefined) {
      return false
    }

    if (/^\d+$/.test(part)) {
      if (isFileType(current) && i + 1 < pathParts.length) {
        return FILE_PROPERTIES.includes(pathParts[i + 1])
      }
      continue
    }

    const arrayMatch = part.match(/^([^[]+)\[(\d+)\]$/)
    if (arrayMatch) {
      const [, prop] = arrayMatch
      const typed = current as Record<string, unknown>

      if (prop in typed) {
        const fieldDef = typed[prop]
        if (isFileType(fieldDef) && i + 1 < pathParts.length) {
          return FILE_PROPERTIES.includes(pathParts[i + 1])
        }
        current = fieldDef
        continue
      }
      return false
    }

    const typed = current as Record<string, unknown>

    if (part in typed) {
      const nextValue = typed[part]
      if (isFileType(nextValue) && i + 1 < pathParts.length) {
        if (/^\d+$/.test(pathParts[i + 1]) && i + 2 < pathParts.length) {
          return FILE_PROPERTIES.includes(pathParts[i + 2])
        }
        return FILE_PROPERTIES.includes(pathParts[i + 1])
      }
      current = nextValue
      continue
    }

    if (typed.properties && typeof typed.properties === 'object') {
      const props = typed.properties as Record<string, unknown>
      if (part in props) {
        current = props[part]
        continue
      }
    }

    if (typed.type === 'array' && typed.items && typeof typed.items === 'object') {
      const items = typed.items as Record<string, unknown>
      if (items.properties && typeof items.properties === 'object') {
        const itemProps = items.properties as Record<string, unknown>
        if (part in itemProps) {
          current = itemProps[part]
          continue
        }
      }
      if (part in items) {
        current = items[part]
        continue
      }
    }

    if (isFileType(current) && FILE_PROPERTIES.includes(part)) {
      return true
    }

    if (
      typeof current === 'object' &&
      current !== null &&
      'type' in current &&
      typeof (current as { type: unknown }).type === 'string'
    ) {
      const typedCurrent = current as { type: string; properties?: unknown; items?: unknown }
      if (!typedCurrent.properties && !typedCurrent.items) {
        return false
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
