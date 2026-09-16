import { AuditAction, AuditResourceType } from '@sim/audit'
import { db } from '@sim/db'
import { organization } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { hasSignInCapableSsoProvider } from '@/lib/auth/sso/verified-provider'
import { invalidateSsoPolicyCache, isSsoRequiredForOrganization } from '@/lib/auth/sso-policy'
import { isOrganizationFeatureEntitled } from '@/lib/billing/core/subscription'
import { recordProjectedUseCaseAuditEntries } from '@/lib/core/application/authorized-workspace-use-case'
import type { OperationUseCase } from '@/lib/core/application/operation'
import { authorizeOrganizationOperation } from '@/lib/core/application/organization-authorization'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { isBillingEnabled, isSsoEnabled } from '@/lib/core/config/env-flags'
import { OrchestrationError } from '@/lib/core/orchestration/types'

/**
 * permission-group-exempt: The sign-in requirement is managed by organization owners and administrators, the same gate as the rest of SSO settings.
 */
export const readSsoRequirementOperation = defineOrganizationOperation({
  id: 'organization.sso.read_requirement',
  minimumRole: 'member',
  principalKinds: ['session'],
  capability: 'none',
})

/**
 * permission-group-exempt: The sign-in requirement is managed by organization owners and administrators, the same gate as the rest of SSO settings.
 */
export const setSsoRequirementOperation = defineOrganizationOperation({
  id: 'organization.sso.set_requirement',
  minimumRole: 'admin',
  principalKinds: ['session'],
  capability: 'none',
})

export interface SsoRequirement {
  /** The stored setting. */
  requireSso: boolean
  /** Whether an identity provider could satisfy it today. */
  hasVerifiedProvider: boolean
  /** Whether sign-in actually enforces it. */
  isEnforced: boolean
}

async function loadRequirement(organizationId: string): Promise<SsoRequirement> {
  const [org] = await db
    .select({ requireSso: organization.requireSso })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1)
  if (!org) throw new OrchestrationError('not_found', 'Organization not found')

  const [hasVerifiedProvider, isEnforced] = await Promise.all([
    hasSignInCapableSsoProvider(organizationId),
    isSsoRequiredForOrganization(organizationId),
  ])
  return { requireSso: org.requireSso, hasVerifiedProvider, isEnforced }
}

export const readSsoRequirement: OperationUseCase<
  typeof readSsoRequirementOperation,
  { organizationId: string },
  SsoRequirement
> = {
  operation: readSsoRequirementOperation,
  async execute({ principal, input }) {
    const { organizationId } = await authorizeOrganizationOperation(
      principal,
      readSsoRequirementOperation,
      input
    )
    return loadRequirement(organizationId)
  },
}

export interface SetSsoRequirementInput {
  organizationId: string
  requireSso: boolean
}

/**
 * Turns the sign-in requirement on or off. It is read when a session is created, so a change ends
 * no session that already exists — signing everyone out stays the separate revoke action.
 */
export const setSsoRequirement: OperationUseCase<
  typeof setSsoRequirementOperation,
  SetSsoRequirementInput,
  SsoRequirement
> = {
  operation: setSsoRequirementOperation,
  async execute({ principal, input, request }) {
    const { organizationId } = await authorizeOrganizationOperation(
      principal,
      setSsoRequirementOperation,
      input
    )

    /**
     * Only turning the requirement on needs the entitlement. Turning it off must stay possible
     * after an organization loses SSO, or the stored setting would resume enforcing the moment
     * the entitlement came back, with no administrator action behind it.
     */
    if (input.requireSso && !(await isOrganizationFeatureEntitled(organizationId, isSsoEnabled))) {
      throw new OrchestrationError(
        'forbidden',
        isBillingEnabled
          ? 'Single Sign-On is available on Enterprise plans only'
          : 'Single Sign-On is disabled. Set ENTERPRISE_ENABLED or SSO_ENABLED to enable it.'
      )
    }

    const hasVerifiedProvider = await hasSignInCapableSsoProvider(organizationId)
    if (input.requireSso && !hasVerifiedProvider) {
      throw new OrchestrationError(
        'conflict',
        'Add an identity provider on a verified domain before requiring single sign-on'
      )
    }

    const [updated] = await db
      .update(organization)
      .set({ requireSso: input.requireSso, updatedAt: new Date() })
      .where(eq(organization.id, organizationId))
      .returning({ name: organization.name })
    if (!updated) throw new OrchestrationError('not_found', 'Organization not found')

    invalidateSsoPolicyCache(organizationId)

    recordProjectedUseCaseAuditEntries(
      setSsoRequirementOperation,
      null,
      principal,
      request,
      [
        {
          action: AuditAction.ORGANIZATION_SSO_POLICY_UPDATED,
          resourceType: AuditResourceType.ORGANIZATION,
          resourceId: organizationId,
          resourceName: updated.name,
          description: input.requireSso
            ? 'Required single sign-on'
            : 'Stopped requiring single sign-on',
          metadata: { requireSso: input.requireSso },
        },
      ],
      organizationId
    )

    /** Everything the requirement needs was just checked, so storing it is enforcing it. */
    return { requireSso: input.requireSso, hasVerifiedProvider, isEnforced: input.requireSso }
  },
}
