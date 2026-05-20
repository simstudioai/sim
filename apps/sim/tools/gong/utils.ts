/**
 * Extract a useful Gong API error message from documented error payloads.
 */
export function getGongErrorMessage(data: unknown, fallback: string): string {
  if (!data || typeof data !== 'object') {
    return fallback
  }

  const payload = data as Record<string, unknown>
  const firstError = Array.isArray(payload.errors) ? payload.errors[0] : undefined
  if (typeof firstError === 'string' && firstError.trim()) {
    return firstError
  }
  if (firstError && typeof firstError === 'object') {
    const message = (firstError as Record<string, unknown>).message
    if (typeof message === 'string' && message.trim()) {
      return message
    }
  }
  if (typeof payload.message === 'string' && payload.message.trim()) {
    return payload.message
  }

  return fallback
}

/**
 * Normalize comma-separated Gong IDs from block text inputs.
 */
export function parseGongIdList(value?: string): string[] | undefined {
  if (!value) {
    return undefined
  }

  const ids = value
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)

  return ids.length > 0 ? ids : undefined
}

/**
 * Parse a JSON object or array field that may already be resolved to structured data.
 */
export function parseGongJsonField<T>(value: unknown, fieldName: string): T {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T
    } catch {
      throw new Error(`${fieldName} must be valid JSON`)
    }
  }

  return value as T
}

/**
 * Parse and validate a JSON array field.
 */
export function parseGongJsonArray(value: unknown, fieldName: string): unknown[] {
  const parsed = parseGongJsonField<unknown>(value, fieldName)
  if (!Array.isArray(parsed)) {
    throw new Error(`${fieldName} must be a JSON array`)
  }

  return parsed
}
