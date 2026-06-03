export interface ResolveAddEmailContext {
  /** Lowercased email -> workspace userId for every workspace member. */
  workspaceUserIdByEmail: Map<string, string>
  /** Lowercased emails that already have access to the credential. */
  existingMemberEmails: Set<string>
}

export type ResolveAddEmailResult = { userId: string } | { error: string }

/**
 * Decide whether a (format-valid, lowercased) email can be added to a
 * credential: it must belong to a workspace member and not already have access.
 * Returns the resolved `userId` on success, or a user-facing `error` message.
 */
export function resolveAddEmail(
  email: string,
  { workspaceUserIdByEmail, existingMemberEmails }: ResolveAddEmailContext
): ResolveAddEmailResult {
  const userId = workspaceUserIdByEmail.get(email)
  if (!userId) return { error: `${email} isn't a member of this workspace` }
  if (existingMemberEmails.has(email)) return { error: `${email} already has access` }
  return { userId }
}

/**
 * Given the targets passed to a batch add and the index-aligned
 * `Promise.allSettled` results, return the targets whose settle rejected.
 */
export function partitionSettledFailures<T>(
  targets: readonly T[],
  results: readonly PromiseSettledResult<unknown>[]
): T[] {
  return targets.filter((_, index) => results[index]?.status === 'rejected')
}
