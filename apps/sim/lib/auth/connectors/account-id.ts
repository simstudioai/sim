const RANDOM_UUID_SUFFIX = /-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * Returns the provider's stable identity inside a connector account id.
 *
 * Each `getUserInfo` in `lib/auth/connectors/providers.ts` appends a random
 * UUID to the stable external id so Better Auth never blocks cross-user
 * connections, which means every connect of the same identity creates a new
 * account row. Rows whose ids share this prefix are the same external identity.
 * Returns `null` for an id that carries no such suffix.
 */
export function stableExternalAccountId(accountId: string): string | null {
  const stable = accountId.replace(RANDOM_UUID_SUFFIX, '')
  return stable && stable !== accountId ? stable : null
}
