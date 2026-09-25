import { AuditAction, AuditResourceType } from '@sim/audit'
import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { member, organization, session } from '@sim/db/schema'
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import { invalidateSecurityPolicyVersionCache } from '@/lib/auth/security-policy'
import { isOrganizationOnEnterprisePlan } from '@/lib/billing/core/subscription'
import { isBillingEnabled } from '@/lib/core/config/env-flags'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { defineOrganizationConfigurationUseCase } from '@/lib/organizations/application/authorized-configuration-use-case'
import { organizationSecurityOperations } from '@/lib/organizations/application/security-operations'

/** A genuine current session is required to preserve caller and impersonator access. */
export const revokeOrganizationSessions = defineOrganizationConfigurationUseCase({
  operation: organizationSecurityOperations.revokeSessions,
  administratorError: 'Forbidden - Only organization owners and admins can revoke sessions',
  async execute({ principal, input }: { principal: Principal; input: { organizationId: string } }) {
    if (principal.kind !== 'session')
      throw new OrchestrationError('forbidden', 'A current browser session is required')
    if (isBillingEnabled && !(await isOrganizationOnEnterprisePlan(input.organizationId)))
      throw new OrchestrationError(
        'forbidden',
        'Session management is available on Enterprise plans only'
      )
    const [org] = await db
      .select({ name: organization.name })
      .from(organization)
      .where(eq(organization.id, input.organizationId))
      .limit(1)
    if (!org) throw new OrchestrationError('not_found', 'Organization not found')
    /** Canonical management target, not authentication: ingress already verified this session. */
    const [current] = await db
      .select({ impersonatedBy: session.impersonatedBy })
      .from(session)
      .where(and(eq(session.id, principal.sessionId), eq(session.userId, principal.userId)))
      .limit(1)
    if (!current)
      throw new OrchestrationError(
        'forbidden',
        'Current session is no longer available. Sign in again.'
      )
    const revoked = await db.transaction(async (tx) => {
      const deleted = await tx
        .delete(session)
        .where(
          and(
            inArray(
              session.userId,
              tx
                .select({ userId: member.userId })
                .from(member)
                .where(eq(member.organizationId, input.organizationId))
            ),
            isNull(session.impersonatedBy),
            ne(session.id, principal.sessionId),
            ...(current.impersonatedBy ? [ne(session.userId, current.impersonatedBy)] : [])
          )
        )
        .returning({ id: session.id })
      await tx
        .update(organization)
        .set({ securityPolicyVersion: sql`${organization.securityPolicyVersion} + 1` })
        .where(eq(organization.id, input.organizationId))
      return deleted
    })
    invalidateSecurityPolicyVersionCache(input.organizationId)
    return { revokedSessions: revoked.length, organizationName: org.name }
  },
  projectAudit: ({ input, result }) => ({
    action: AuditAction.ORGANIZATION_SESSIONS_REVOKED,
    resourceType: AuditResourceType.ORGANIZATION,
    resourceId: input.organizationId,
    resourceName: result.organizationName,
    description: `Revoked ${result.revokedSessions} member session${result.revokedSessions === 1 ? '' : 's'}`,
    metadata: { revokedSessions: result.revokedSessions },
  }),
})
