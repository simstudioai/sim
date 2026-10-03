import { isRecordLike } from '@sim/utils/object'
export function parseDataArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (typeof value === 'string' && value.trim().length > 0) {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

export function parseFiltersObject(value: unknown): Record<string, unknown> {
  if (isRecordLike(value)) {
    return value as Record<string, unknown>
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    try {
      const parsed = JSON.parse(value)
      if (isRecordLike(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {}
  }
  return {}
}
