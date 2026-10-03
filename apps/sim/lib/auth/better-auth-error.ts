/**
 * The 4xx status a Better Auth refusal carries, or `undefined` when the failure is the server's.
 *
 * Better Auth throws `APIError` for ordinary caller mistakes — an invalid or already-consumed
 * reset token, an expired session, a password outside the configured length. A route that catches
 * one without reading the status reports a 400-class refusal as a 500: it pages on a routine user
 * action and tells the caller the server broke.
 *
 * Read off the instance rather than with `instanceof`, because `APIError` belongs to a transitive
 * dependency and a duplicated copy in the tree would silently defeat the check.
 */
export function getBetterAuthClientErrorStatus(error: unknown): number | undefined {
  if (!(error instanceof Error)) return undefined
  const statusCode = (error as { statusCode?: unknown }).statusCode
  return typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500
    ? statusCode
    : undefined
}
