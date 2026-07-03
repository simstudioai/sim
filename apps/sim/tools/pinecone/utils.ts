/**
 * Parse a Pinecone param that may arrive as a JSON string (from a block input or
 * agent tool-call) or as an already-parsed value. Throws a descriptive error when
 * a provided string is not valid JSON, instead of letting `JSON.parse` crash.
 */
export function parseJsonParam<T>(value: unknown, fieldName: string): T {
  if (typeof value !== 'string') {
    return value as T
  }
  try {
    return JSON.parse(value) as T
  } catch {
    throw new Error(`${fieldName} must be valid JSON`)
  }
}
