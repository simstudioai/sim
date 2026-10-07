import { type Principal, requirePrincipalSubjectUserId } from '@sim/auth/principal'
import { user } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { getActivelyBannedUserIds, isAccountBlocked } from '@/lib/auth/ban'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbTransaction } from '@/lib/db/types'

type FileSubjectPrincipal = Extract<Principal, { userId: string } | { subjectUserId: string }>

/** Resolves the acting human and applies admission-time account and deployment restrictions. */
export async function requireFileSubject(principal: FileSubjectPrincipal): Promise<string> {
  // actorless-unsupported: Project files and cross-owner copies require a human; their operation registries reject workspace keys and executors.
  const userId = requirePrincipalSubjectUserId(principal)
  if ((await getActivelyBannedUserIds([userId])).length) {
    throw new OrchestrationError('forbidden', 'User account is suspended')
  }
  return userId
}

/** Holds the acting account stable through a file transaction without substituting an owner. */
export async function requireCurrentFileSubject(
  tx: DbTransaction,
  principal: FileSubjectPrincipal
): Promise<void> {
  // actorless-unsupported: Project files and cross-owner copies require a human; their operation registries reject workspace keys and executors.
  const userId = requirePrincipalSubjectUserId(principal)
  const [actor] = await tx
    .select({ banned: user.banned, banExpires: user.banExpires, suspendedAt: user.suspendedAt })
    .from(user)
    .where(eq(user.id, userId))
    .for('share')
    .limit(1)
  if (!actor || isAccountBlocked(actor)) {
    throw new OrchestrationError('forbidden', 'User account is suspended')
  }
}
