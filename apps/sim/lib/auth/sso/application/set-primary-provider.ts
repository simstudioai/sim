import { AuditAction, AuditResourceType } from '@sim/audit'
import { db } from '@sim/db'
import { ssoDomain, ssoProvider } from '@sim/db/schema'
import { verifiedDomainOfProvider } from '@sim/db/sso-primary-provider'
import { and, eq, exists, sql } from 'drizzle-orm'
import { recordProjectedUseCaseAuditEntries } from '@/lib/core/application/authorized-workspace-use-case'
import type { OperationUseCase } from '@/lib/core/application/operation'
import { authorizeOrganizationOperation } from '@/lib/core/application/organization-authorization'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'

/**
 * permission-group-exempt: SSO providers are managed by organization owners and administrators, the same gate as the rest of SSO settings.
 */
export const setPrimarySsoProviderOperation = defineOrganizationOperation({
  id: 'organization.sso.set_primary_provider',
  minimumRole: 'admin',
  principalKinds: ['session'],
  capability: 'none',
})

export interface SetPrimarySsoProviderInput {
  providerId: string
}

export interface SetPrimarySsoProviderResult {
  providerId: string
  organizationId: string
  domain: string
}

/**
 * Makes a provider the one its verified domain signs in through. The previous
 * primary stays configured and reachable by test link, so the switch can be
 * reversed the same way. Only organization providers have a primary; a personal
 * provider reads as not found, like one the caller cannot see.
 */
export const setPrimarySsoProvider: OperationUseCase<
  typeof setPrimarySsoProviderOperation,
  SetPrimarySsoProviderInput,
  SetPrimarySsoProviderResult
> = {
  operation: setPrimarySsoProviderOperation,
  async execute({ principal, input, request }) {
    const [provider] = await db
      .select({
        id: ssoProvider.id,
        organizationId: ssoProvider.organizationId,
        domain: ssoProvider.domain,
      })
      .from(ssoProvider)
      .where(eq(ssoProvider.providerId, input.providerId))
      .limit(1)
    if (!provider?.organizationId) {
      throw new OrchestrationError('not_found', 'Provider not found')
    }
    const { organizationId } = await authorizeOrganizationOperation(
      principal,
      setPrimarySsoProviderOperation,
      { organizationId: provider.organizationId }
    )

    /**
     * Names the provider on the one domain record sign-in joins it to, so a
     * provider this succeeds for is exactly the one sign-in then uses.
     */
    const named = await db
      .update(ssoDomain)
      .set({ primaryProviderId: input.providerId, updatedAt: new Date() })
      .where(
        and(
          eq(ssoDomain.organizationId, organizationId),
          exists(
            db
              .select({ found: sql`1` })
              .from(ssoProvider)
              .where(
                and(
                  eq(ssoProvider.id, provider.id),
                  eq(ssoProvider.domainVerified, true),
                  verifiedDomainOfProvider
                )
              )
          )
        )
      )
      .returning({ id: ssoDomain.id })
    if (named.length === 0) {
      throw new OrchestrationError(
        'conflict',
        `Verify ${provider.domain} before making this provider primary.`
      )
    }

    recordProjectedUseCaseAuditEntries(
      setPrimarySsoProviderOperation,
      null,
      principal,
      request,
      [
        {
          action: AuditAction.ORGANIZATION_SSO_PRIMARY_PROVIDER_CHANGED,
          resourceType: AuditResourceType.ORGANIZATION,
          resourceId: organizationId,
          description: `Made ${input.providerId} the primary SSO provider for ${provider.domain}`,
          metadata: { providerId: input.providerId, domain: provider.domain },
        },
      ],
      organizationId
    )
    return { providerId: input.providerId, organizationId, domain: provider.domain }
  },
}
