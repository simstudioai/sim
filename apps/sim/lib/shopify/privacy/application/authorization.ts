import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { user } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { isAccountBlocked } from '@/lib/auth/ban'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbTransaction } from '@/lib/db/types'

/** Rechecks current platform authority on the primary; no workspace owner is substituted. */
export async function authorizePrivacyOperator(
  principal: Principal,
  transaction?: DbTransaction
): Promise<string> {
  if (principal.kind !== 'session') {
    throw new OrchestrationError('forbidden', 'A platform administrator session is required')
  }
  const query = (transaction ?? db)
    .select({
      role: user.role,
      banned: user.banned,
      banExpires: user.banExpires,
      suspendedAt: user.suspendedAt,
    })
    .from(user)
    .where(eq(user.id, principal.userId))
    .limit(1)
  const [operator] = await (transaction ? query.for('share') : query)
  if (!operator || operator.role !== 'admin' || isAccountBlocked(operator)) {
    throw new OrchestrationError('forbidden', 'A current platform administrator is required')
  }
  return principal.userId
}
