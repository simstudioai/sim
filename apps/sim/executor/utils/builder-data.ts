import { REFERENCE } from '@/executor/constants'

export interface JSONProperty {
  id: string
  name: string
  type: string
  value: unknown
  collapsed?: boolean
}

/**
 * Converts builder data (structured JSON properties) into a plain JSON object.
 */
export function convertBuilderDataToJson(builderData: JSONProperty[]): Record<string, unknown> {
  if (!Array.isArray(builderData)) {
    return {}
  }

  const result: Record<string, unknown> = {}

  for (const prop of builderData) {
    if (!prop.name || !prop.name.trim()) {
      continue
    }

    const value = convertPropertyValue(prop)
    result[prop.name] = value
  }

  return result
}

/**
 * Converts builder data into a JSON string with variable references unquoted.
 */
export function convertBuilderDataToJsonString(builderData: JSONProperty[]): string {
  if (!Array.isArray(builderData) || builderData.length === 0) {
    return '{\n  \n}'
  }

  const result: Record<string, unknown> = {}

  for (const prop of builderData) {
    if (!prop.name || !prop.name.trim()) {
      continue
    }

    result[prop.name] = prop.value
  }

  let jsonString = JSON.stringify(result, null, 2)

  jsonString = jsonString.replace(/"(<[^>]+>)"/g, '$1')

  return jsonString
}

export function convertPropertyValue(prop: JSONProperty): unknown {
  switch (prop.type) {
    case 'object':
      return convertObjectValue(prop.value)
    case 'array':
      return convertArrayValue(prop.value)
    case 'number':
      return convertNumberValue(prop.value)
    case 'boolean':
      return convertBooleanValue(prop.value)
    case 'files':
      return prop.value
    default:
      return prop.value
  }
}

function convertObjectValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return convertBuilderDataToJson(value as JSONProperty[])
  }

  if (typeof value === 'string' && !isVariableReference(value)) {
    return tryParseJson(value, value)
  }

  return value
}

function convertArrayValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item: unknown) => convertArrayItem(item))
  }

  if (typeof value === 'string' && !isVariableReference(value)) {
    const parsed = tryParseJson(value, value)
    return Array.isArray(parsed) ? parsed : value
  }

  return value
}

function convertArrayItem(item: unknown): unknown {
  if (typeof item !== 'object' || item === null || !('type' in item)) {
    return item
  }

  const record = item as Record<string, unknown>
  if (typeof record.type !== 'string') {
    return item
  }

  const typed = record as { type: string; value: unknown }

  if (typed.type === 'object' && Array.isArray(typed.value)) {
    return convertBuilderDataToJson(typed.value as JSONProperty[])
  }

  if (typed.type === 'array' && Array.isArray(typed.value)) {
    return (typed.value as unknown[]).map((subItem: unknown) =>
      typeof subItem === 'object' && subItem !== null && 'value' in subItem
        ? (subItem as { value: unknown }).value
        : subItem
    )
  }

  return typed.value
}

function convertNumberValue(value: unknown): unknown {
  if (isVariableReference(value)) {
    return value
  }

  const numValue = Number(value)
  return Number.isNaN(numValue) ? value : numValue
}

function convertBooleanValue(value: unknown): unknown {
  if (isVariableReference(value)) {
    return value
  }

  return value === 'true' || value === true
}

function tryParseJson(jsonString: string, fallback: unknown): unknown {
  try {
    return JSON.parse(jsonString)
  } catch {
    return fallback
  }
}

function isVariableReference(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    value.trim().startsWith(REFERENCE.START) &&
    value.trim().includes(REFERENCE.END)
  )
}
