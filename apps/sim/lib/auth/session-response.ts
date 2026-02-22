export function extractSessionDataFromAuthClientResult(result: unknown): unknown | null {
  if (!result || typeof result !== 'object') {
    return null
  }

  const record = result as Record<string, unknown>

  // Expected shape from better-auth client: { data: <session> }
  if ('data' in record) {
    return (record as { data?: unknown }).data ?? null
  }

  // Fallback for raw session payloads: { user, session }
  if ('user' in record) {
    return record
  }

  return null
}
