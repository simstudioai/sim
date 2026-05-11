import type { WorkflowSearchValuePath } from '@/lib/workflows/search-replace/types'

export interface WalkedStringValue {
  path: WorkflowSearchValuePath
  value: string
  originalValue: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function walkStringValues(
  value: unknown,
  path: WorkflowSearchValuePath = []
): WalkedStringValue[] {
  if (typeof value === 'string') {
    return value.length > 0 ? [{ path, value, originalValue: value }] : []
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return [{ path, value: String(value), originalValue: value }]
  }

  if (Array.isArray(value)) {
    return value.flatMap((item, index) => walkStringValues(item, [...path, index]))
  }

  if (isRecord(value)) {
    return Object.entries(value).flatMap(([key, item]) => walkStringValues(item, [...path, key]))
  }

  return []
}

export function getValueAtPath(value: unknown, path: WorkflowSearchValuePath): unknown {
  return path.reduce<unknown>((current, segment) => {
    if (Array.isArray(current) && typeof segment === 'number') {
      return current[segment]
    }
    if (isRecord(current) && typeof segment === 'string') {
      return current[segment]
    }
    return undefined
  }, value)
}

export function setValueAtPath(
  value: unknown,
  path: WorkflowSearchValuePath,
  nextValue: unknown
): unknown {
  if (path.length === 0) return nextValue

  const [segment, ...remaining] = path

  if (Array.isArray(value)) {
    const copy = [...value]
    if (typeof segment !== 'number') return value
    copy[segment] = setValueAtPath(copy[segment], remaining, nextValue)
    return copy
  }

  if (isRecord(value)) {
    if (typeof segment !== 'string') return value
    return {
      ...value,
      [segment]: setValueAtPath(value[segment], remaining, nextValue),
    }
  }

  return value
}

export function pathToKey(path: WorkflowSearchValuePath): string {
  return path.map((segment) => String(segment).replaceAll('.', '\\.')).join('.')
}
