export interface SanitizedQuickBooksFault {
  Fault: {
    Error: Array<Record<string, string>>
  }
}

export function sanitizeQuickBooksFaultData(data: unknown): SanitizedQuickBooksFault | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const fault = (data as Record<string, unknown>).Fault
  if (!fault || typeof fault !== 'object' || Array.isArray(fault)) return null
  const errors = (fault as Record<string, unknown>).Error
  if (!Array.isArray(errors)) return null

  return {
    Fault: {
      Error: errors.flatMap((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
        const value = entry as Record<string, unknown>
        const sanitized = Object.fromEntries(
          ['code', 'Message', 'Detail', 'element'].flatMap((key) =>
            typeof value[key] === 'string' ? [[key, value[key]]] : []
          )
        )
        return Object.keys(sanitized).length > 0 ? [sanitized] : []
      }),
    },
  }
}

export function formatQuickBooksFaultDetail(fault: SanitizedQuickBooksFault): string {
  return fault.Fault.Error.map((error) => {
    const code = error.code?.trim() ?? ''
    const message = error.Message?.trim() ?? ''
    const detail = error.Detail?.trim() ?? ''
    const text = [message, detail].filter(Boolean).join(': ')
    return text ? (code ? `${code}: ${text}` : text) : ''
  })
    .filter(Boolean)
    .join('; ')
}
