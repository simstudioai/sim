/**
 * Return a Kitt response as a record or reject the undocumented shape.
 *
 * Kitt's official Postman collection documents real-time results but publishes
 * no response example. The official production client reads a completed job's
 * root `outcome`, plus `results.botGeneratedEmail` for a successful finder.
 * The integration intentionally validates only that smallest observed shape.
 * Sources retrieved 2026-08-26:
 * https://documenter.getpostman.com/view/479833/2s93m62NHf
 * https://admin.trykitt.ai/static/js/383.00ea5565.chunk.js.map
 * https://admin.trykitt.ai/static/js/514.32c9725d.chunk.js.map
 */
export function requireKittResponseObject(
  value: unknown,
  operation: 'find email' | 'verify email'
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Kitt ${operation} response must be a JSON object`)
  }
  return value as Record<string, unknown>
}

export function requireKittResponseString(
  value: unknown,
  field: string,
  operation: 'find email' | 'verify email'
): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Kitt ${operation} response is missing required ${field}`)
  }
  return value
}

export async function requireKittSuccess(
  response: Response,
  operation: 'find email' | 'verify email'
): Promise<void> {
  if (response.ok) return
  const errorText = await response.text()
  throw new Error(`Kitt ${operation} API error: ${response.status} - ${errorText}`)
}
