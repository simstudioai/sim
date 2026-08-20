/**
 * Shared normalizers for the `tableRowExecutions` sidecar columns that are
 * stored looser than every consumer declares them.
 *
 * Internal module: not exposed via the `@/lib/table` barrel.
 */

/**
 * Projects the schemaless `blockErrors` jsonb column onto the
 * `Record<string, string>` shape the domain type and the published contract
 * both declare, dropping any member that is not a string.
 *
 * The writers guard the shape today, so a drifted blob is latent rather than
 * observed — but it is caller-reachable on read, and `z.record(z.string(),
 * z.string())` in a response slot turns one bad row into a 500 on a well-formed
 * request. Returns `undefined` for an empty result so callers can omit the key
 * rather than publish an empty map.
 */
export function normalizeBlockErrors(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined

  const blockErrors: Record<string, string> = {}
  for (const [blockId, error] of Object.entries(value)) {
    if (typeof error === 'string') blockErrors[blockId] = error
  }
  return Object.keys(blockErrors).length > 0 ? blockErrors : undefined
}
