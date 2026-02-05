export function maskCredentialIdsInValue(value: any, credentialIds: Set<string>): any {
  if (!value || credentialIds.size === 0) return value

  if (typeof value === 'string') {
    let masked = value
    const sortedIds = Array.from(credentialIds).sort((a, b) => b.length - a.length)
    for (const id of sortedIds) {
      if (id && masked.includes(id)) {
        masked = masked.split(id).join('••••••••')
      }
    }
    return masked
  }

  if (Array.isArray(value)) {
    return value.map((item) => maskCredentialIdsInValue(item, credentialIds))
  }

  if (typeof value === 'object') {
    const masked: any = {}
    for (const key of Object.keys(value)) {
      masked[key] = maskCredentialIdsInValue(value[key], credentialIds)
    }
    return masked
  }

  return value
}
