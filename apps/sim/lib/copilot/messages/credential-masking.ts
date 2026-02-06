export function maskCredentialIdsInValue<T>(value: T, credentialIds: Set<string>): T {
  if (!value || credentialIds.size === 0) return value

  if (typeof value === 'string') {
    let masked = value as string
    const sortedIds = Array.from(credentialIds).sort((a, b) => b.length - a.length)
    for (const id of sortedIds) {
      if (id && masked.includes(id)) {
        masked = masked.split(id).join('••••••••')
      }
    }
    return masked as unknown as T
  }

  if (Array.isArray(value)) {
    return value.map((item) => maskCredentialIdsInValue(item, credentialIds)) as T
  }

  if (typeof value === 'object') {
    const masked: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>)) {
      masked[key] = maskCredentialIdsInValue((value as Record<string, unknown>)[key], credentialIds)
    }
    return masked as T
  }

  return value
}
