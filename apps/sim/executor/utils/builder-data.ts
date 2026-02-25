import { REFERENCE } from '@/executor/constants'

export interface JSONProperty {
  id: string
  name: string
  type: string
  value: any
  collapsed?: boolean
}

/**
 * Converts builder data (structured JSON properties) into a plain JSON object.
 */
export function convertBuilderDataToJson(builderData: JSONProperty[]): any {
  if (!Array.isArray(builderData)) {
    return {}
  }

  const result: any = {}

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

  const result: any = {}

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

export function convertPropertyValue(prop: JSONProperty): any {
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

function convertObjectValue(value: any): any {
  if (Array.isArray(value)) {
    return convertBuilderDataToJson(value)
  }

  if (typeof value === 'string' && !isVariableReference(value)) {
    return tryParseJson(value, value)
  }

  return value
}

function convertArrayValue(value: any): any {
  if (Array.isArray(value)) {
    return value.map((item: any) => convertArrayItem(item))
  }

  if (typeof value === 'string' && !isVariableReference(value)) {
    const parsed = tryParseJson(value, value)
    return Array.isArray(parsed) ? parsed : value
  }

  return value
}

function convertArrayItem(item: any): any {
  if (typeof item !== 'object' || !item.type) {
    return item
  }

  if (item.type === 'object' && Array.isArray(item.value)) {
    return convertBuilderDataToJson(item.value)
  }

  if (item.type === 'array' && Array.isArray(item.value)) {
    return item.value.map((subItem: any) =>
      typeof subItem === 'object' && subItem.type ? subItem.value : subItem
    )
  }

  return item.value
}

function convertNumberValue(value: any): any {
  if (isVariableReference(value)) {
    return value
  }

  const numValue = Number(value)
  return Number.isNaN(numValue) ? value : numValue
}

function convertBooleanValue(value: any): any {
  if (isVariableReference(value)) {
    return value
  }

  return value === 'true' || value === true
}

function tryParseJson(jsonString: string, fallback: any): any {
  try {
    return JSON.parse(jsonString)
  } catch {
    return fallback
  }
}

function isVariableReference(value: any): boolean {
  return (
    typeof value === 'string' &&
    value.trim().startsWith(REFERENCE.START) &&
    value.trim().includes(REFERENCE.END)
  )
}
