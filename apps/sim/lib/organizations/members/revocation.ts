import { apiKey, organization, session as sessionTable } from '@sim/db/schema'
import { and, eq, isNull, ne, sql } from 'drizzle-orm'
import {
  invalidateMembershipCache,
  invalidateSecurityPolicyVersionCache,
} from '@/lib/auth/security-policy'
import type { DbOrTx } from '@/lib/db/types'

/**
 * Ending a person's live access: their sessions and their personal API keys.
 *
 * Shared by removal from an organization, suspension, and an email change, so
 * every path that must sign someone out does it the same way. Kept apart from
 * the membership primitives so the removal transaction can call it without a
 * module cycle.
 */

export interface RevokeSessionsResult {
  revoked: number
}

/**
 * Deletes a user's sessions and forces cached session cookies in the
 * organization to re-read the database.
 *
 * Both halves commit together. Deleting sessions without bumping the version
 * would leave the signed cookie cache authenticating a deleted session for up
 * to five minutes, which is precisely the window a revocation exists to close.
 *
 * Impersonation sessions are spared: they are platform support tooling, not the
 * member's own access.
 */
export async function revokeUserSessionsTx(
  tx: DbOrTx,
  params: { userId: string; organizationId: string; spareSessionToken?: string }
): Promise<RevokeSessionsResult> {
  const deleted = await tx
    .delete(sessionTable)
    .where(
      and(
        eq(sessionTable.userId, params.userId),
        isNull(sessionTable.impersonatedBy),
        ...(params.spareSessionToken ? [ne(sessionTable.token, params.spareSessionToken)] : [])
      )
    )
    .returning({ id: sessionTable.id })

  await tx
    .update(organization)
    .set({ securityPolicyVersion: sql`${organization.securityPolicyVersion} + 1` })
    .where(eq(organization.id, params.organizationId))

  return { revoked: deleted.length }
}

/**
 * Drops the caches that make a revocation visible to the next request.
 *
 * Separate from the transaction on purpose: an in-process cache cleared before
 * the commit lands would be repopulated with the pre-commit answer.
 */
export function invalidateAfterSessionRevocation(params: {
  userId: string
  organizationId: string
}): void {
  invalidateSecurityPolicyVersionCache(params.organizationId)
  invalidateMembershipCache(params.userId)
}

/**
 * Deletes a user's personal API keys.
 *
 * Workspace keys are left alone: they belong to the workspace and are shared, so
 * one person's departure must not break every automation using them.
 */
export async function revokePersonalApiKeysTx(
  tx: DbOrTx,
  params: { userId: string }
): Promise<{ revoked: number }> {
  const deleted = await tx
    .delete(apiKey)
    .where(and(eq(apiKey.userId, params.userId), eq(apiKey.type, 'personal')))
    .returning({ id: apiKey.id })
  return { revoked: deleted.length }
}
