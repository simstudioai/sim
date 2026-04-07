export function extractSalesforceObjectTypeFromPayload(
  body: Record<string, unknown>
): string | undefined {
  const direct =
    (typeof body.objectType === 'string' && body.objectType) ||
    (typeof body.sobjectType === 'string' && body.sobjectType) ||
    undefined
  if (direct) {
    return direct
  }

  const attrs = body.attributes as Record<string, unknown> | undefined
  if (typeof attrs?.type === 'string') {
    return attrs.type
  }

  const record = body.record
  if (record && typeof record === 'object' && !Array.isArray(record)) {
    const r = record as Record<string, unknown>
    if (typeof r.sobjectType === 'string') {
      return r.sobjectType
    }
    const ra = r.attributes as Record<string, unknown> | undefined
    if (typeof ra?.type === 'string') {
      return ra.type
    }
  }

  return undefined
}
