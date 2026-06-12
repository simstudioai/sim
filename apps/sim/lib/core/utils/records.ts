export type UnknownRecord = Record<string, unknown>
export type StringRecord = Record<string, string>

/**
 * Returns true only for object-map values, excluding arrays and null.
 */
export function isPlainRecord(value: unknown): value is UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }

  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/**
 * Normalizes optional execution context maps to the record shape expected by
 * internal API contracts.
 */
export function normalizeRecord(value: unknown): UnknownRecord {
  return isPlainRecord(value) ? value : {}
}

/**
 * Normalizes environment-like maps to string values, matching process/env
 * semantics at execution boundaries.
 */
export function normalizeStringRecord(value: unknown): StringRecord {
  if (!isPlainRecord(value)) {
    return {}
  }

  const normalized: StringRecord = {}
  for (const [key, entryValue] of Object.entries(value)) {
    if (entryValue === undefined || entryValue === null) {
      continue
    }
    normalized[key] = typeof entryValue === 'string' ? entryValue : String(entryValue)
  }
  return normalized
}

/**
 * Normalizes record-of-record maps such as block output schema maps.
 */
export function normalizeRecordMap(value: unknown): Record<string, UnknownRecord> {
  if (!isPlainRecord(value)) {
    return {}
  }

  const normalized: Record<string, UnknownRecord> = {}
  for (const [key, entryValue] of Object.entries(value)) {
    if (isPlainRecord(entryValue)) {
      normalized[key] = entryValue
    }
  }
  return normalized
}

/**
 * Workflow variables are stored as a record in current state, while some
 * legacy and imported snapshots can carry an array of variable objects.
 */
export function normalizeWorkflowVariables(value: unknown): UnknownRecord {
  if (isPlainRecord(value)) {
    return value
  }

  if (!Array.isArray(value)) {
    return {}
  }

  const normalized: UnknownRecord = {}
  for (const variable of value) {
    if (!isPlainRecord(variable)) {
      continue
    }

    const id = typeof variable.id === 'string' && variable.id.trim() ? variable.id : undefined
    const name =
      typeof variable.name === 'string' && variable.name.trim() ? variable.name : undefined
    const key = id ?? name

    if (key) {
      normalized[key] = variable
    }
  }

  return normalized
}
