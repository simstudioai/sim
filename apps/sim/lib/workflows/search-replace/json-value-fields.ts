import type { SubBlockType } from '@sim/workflow-types/blocks'
import type {
  WorkflowSearchRange,
  WorkflowSearchValuePath,
} from '@/lib/workflows/search-replace/types'
import { getValueAtPath, setValueAtPath } from '@/lib/workflows/search-replace/value-walker'

const SEARCHABLE_JSON_ARRAY_VALUE_FIELDS: Partial<Record<SubBlockType, Record<string, string>>> = {
  'condition-input': {
    value: 'Condition',
  },
  'router-input': {
    value: 'Route',
  },
  'knowledge-tag-filters': {
    tagValue: 'Value',
    valueTo: 'Value To',
  },
  'document-tag-entry': {
    value: 'Value',
  },
  'variables-input': {
    value: 'Value',
  },
}

const SEARCHABLE_JSON_OBJECT_VALUE_FIELDS: Partial<Record<SubBlockType, string>> = {
  'input-mapping': 'Value',
  'workflow-input-mapper': 'Value',
}

const SERIALIZED_SUBBLOCK_VALUE_TYPES = new Set<SubBlockType>([
  'file-upload',
  'grouped-checkbox-list',
  'table',
])

export interface SearchableJsonStringLeaf {
  path: WorkflowSearchValuePath
  value: string
  originalValue: string
  fieldTitle: string
}

export interface JsonStringLeafReplacementResult {
  handled: boolean
  success: boolean
  nextValue?: unknown
  reason?: string
}

function parseJsonValue(value: string): unknown | null {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function getParsedValue(value: unknown): { parsed: unknown; stringify: boolean } | null {
  if (typeof value === 'string') {
    const parsed = parseJsonValue(value)
    return parsed === null ? null : { parsed, stringify: true }
  }

  if (value && typeof value === 'object') {
    return { parsed: value, stringify: false }
  }

  return null
}

function getObjectStringLeaves({
  value,
  path = [],
  fieldTitle,
}: {
  value: unknown
  path?: WorkflowSearchValuePath
  fieldTitle: string
}): SearchableJsonStringLeaf[] {
  if (typeof value === 'string' && value.length > 0) {
    return [{ path, value, originalValue: value, fieldTitle }]
  }

  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      getObjectStringLeaves({ value: item, path: [...path, index], fieldTitle })
    )
  }

  if (!value || typeof value !== 'object') return []

  return Object.entries(value).flatMap(([fieldKey, fieldValue]) =>
    getObjectStringLeaves({ value: fieldValue, path: [...path, fieldKey], fieldTitle })
  )
}

export function isSearchableJsonValueSubBlock(
  subBlockType: SubBlockType | undefined
): subBlockType is
  | 'condition-input'
  | 'router-input'
  | 'knowledge-tag-filters'
  | 'document-tag-entry'
  | 'variables-input'
  | 'input-mapping'
  | 'workflow-input-mapper'
  | 'table' {
  return Boolean(
    subBlockType &&
      (subBlockType === 'table' ||
        SEARCHABLE_JSON_ARRAY_VALUE_FIELDS[subBlockType] ||
        SEARCHABLE_JSON_OBJECT_VALUE_FIELDS[subBlockType])
  )
}

export function shouldParseSerializedSubBlockValue(
  subBlockType: SubBlockType | undefined
): subBlockType is SubBlockType {
  return Boolean(
    subBlockType &&
      (isSearchableJsonValueSubBlock(subBlockType) ||
        SERIALIZED_SUBBLOCK_VALUE_TYPES.has(subBlockType))
  )
}

export function getSearchableJsonStringLeaves(
  value: unknown,
  subBlockType: SubBlockType | undefined
): SearchableJsonStringLeaf[] {
  const parsedValue = getParsedValue(value)
  if (!parsedValue) return []
  const { parsed } = parsedValue

  if (subBlockType === 'table') {
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((row, rowIndex) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) return []
      const cells = (row as Record<string, unknown>).cells
      if (!cells || typeof cells !== 'object' || Array.isArray(cells)) return []
      return Object.entries(cells).flatMap(([column, cellValue]) =>
        typeof cellValue === 'string' && cellValue.length > 0
          ? [
              {
                path: [rowIndex, 'cells', column],
                value: cellValue,
                originalValue: cellValue,
                fieldTitle: column,
              },
            ]
          : []
      )
    })
  }

  const arrayFieldTitles = subBlockType
    ? SEARCHABLE_JSON_ARRAY_VALUE_FIELDS[subBlockType]
    : undefined
  if (arrayFieldTitles) {
    if (!Array.isArray(parsed)) return []

    return parsed.flatMap((row, index) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) return []
      return Object.entries(arrayFieldTitles).flatMap(([fieldKey, fieldTitle]) => {
        const fieldValue = (row as Record<string, unknown>)[fieldKey]
        return typeof fieldValue === 'string' && fieldValue.length > 0
          ? [{ path: [index, fieldKey], value: fieldValue, originalValue: fieldValue, fieldTitle }]
          : []
      })
    })
  }

  const objectFieldTitle = subBlockType
    ? SEARCHABLE_JSON_OBJECT_VALUE_FIELDS[subBlockType]
    : undefined
  if (objectFieldTitle) {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return []
    return getObjectStringLeaves({ value: parsed, fieldTitle: objectFieldTitle })
  }

  return []
}

export function replaceJsonStringLeafRange({
  value,
  subBlockType,
  path,
  range,
  rawValue,
  replacement,
}: {
  value: unknown
  subBlockType: SubBlockType | undefined
  path: WorkflowSearchValuePath
  range: WorkflowSearchRange
  rawValue: string
  replacement: string
}): JsonStringLeafReplacementResult {
  if (!isSearchableJsonValueSubBlock(subBlockType)) {
    return { handled: false, success: false }
  }

  const parsedValue = getParsedValue(value)
  if (!parsedValue) {
    return { handled: true, success: false, reason: 'Target JSON is no longer valid' }
  }
  const { parsed, stringify } = parsedValue

  const currentLeaf = getValueAtPath(parsed, path)
  if (typeof currentLeaf !== 'string') {
    for (let prefixLength = path.length - 1; prefixLength > 0; prefixLength -= 1) {
      const valuePrefix = path.slice(0, prefixLength)
      const nestedValue = getValueAtPath(parsed, valuePrefix)
      if (typeof nestedValue !== 'string') continue

      const nestedResult = replaceJsonStringLeafRange({
        value: nestedValue,
        subBlockType,
        path: path.slice(prefixLength),
        range,
        rawValue,
        replacement,
      })
      if (!nestedResult.handled || !nestedResult.success) return nestedResult

      return {
        handled: true,
        success: true,
        nextValue: stringify
          ? JSON.stringify(setValueAtPath(parsed, valuePrefix, nestedResult.nextValue))
          : setValueAtPath(parsed, valuePrefix, nestedResult.nextValue),
      }
    }
  }

  if (typeof currentLeaf !== 'string') {
    return { handled: true, success: false, reason: 'Target value is no longer text' }
  }

  const currentRawValue = currentLeaf.slice(range.start, range.end)
  if (currentRawValue !== rawValue) {
    return { handled: true, success: false, reason: 'Target text changed since search' }
  }

  const nextLeaf = `${currentLeaf.slice(0, range.start)}${replacement}${currentLeaf.slice(range.end)}`
  return {
    handled: true,
    success: true,
    nextValue: stringify
      ? JSON.stringify(setValueAtPath(parsed, path, nextLeaf))
      : setValueAtPath(parsed, path, nextLeaf),
  }
}
