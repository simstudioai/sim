export interface ResolveAddEmailContext {
  /** Lowercased email -> workspace userId for every workspace member. */
  workspaceUserIdByEmail: Map<string, string>
  /** Lowercased emails that already have access to the resource. */
  existingMemberEmails: Set<string>
}

export type ResolveAddEmailResult = { userId: string } | { error: string }

/**
 * Decide whether a format-valid email can be added to a shared resource
 * (credential, skill): it must
 * belong to a workspace member and not already have access. Matching is
 * case-insensitive (the context map/set are keyed by lowercased email) while
 * error messages echo the email as the user typed it. Returns the resolved
 * `userId` on success, or a user-facing `error` message.
 */
export function resolveAddEmail(
  email: string,
  { workspaceUserIdByEmail, existingMemberEmails }: ResolveAddEmailContext
): ResolveAddEmailResult {
  const normalized = email.toLowerCase()
  const userId = workspaceUserIdByEmail.get(normalized)
  if (!userId) return { error: `${email} isn't a member of this workspace` }
  if (existingMemberEmails.has(normalized)) return { error: `${email} already has access` }
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
