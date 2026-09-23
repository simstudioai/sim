import { AuditAction, AuditResourceType } from '@sim/audit'
import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { ssoDomain, ssoProvider } from '@sim/db/schema'
import { ssoProviderDomainKey } from '@sim/db/sso-primary-provider'
import { getPostgresErrorCode } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { normalizeSSODomain } from '@sim/utils/sso-domain'
import { and, asc, eq, sql } from 'drizzle-orm'
import {
  buildChallengeHost,
  checkDomainTxtRecord,
  generateVerificationToken,
} from '@/lib/auth/sso/domain-verification'
import { invalidateSsoPolicyCache } from '@/lib/auth/sso-policy'
import { isOrganizationOnEnterprisePlan } from '@/lib/billing/core/subscription'
import { isBillingEnabled } from '@/lib/core/config/env-flags'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { defineOrganizationConfigurationUseCase } from '@/lib/organizations/application/authorized-configuration-use-case'
import { organizationSecurityOperations } from '@/lib/organizations/application/security-operations'
import {
  addOrganizationDomainBodySchema,
  MAX_ORGANIZATION_DOMAINS,
} from '@/lib/organizations/domain-validation'

type DomainRow = typeof ssoDomain.$inferSelect
export type DomainSettingsValue = Omit<DomainRow, 'verificationToken'> & {
  verificationToken: string | null
}
interface OrganizationInput {
  organizationId: string
}
interface DomainInput extends OrganizationInput {
  domainId: string
}

function domainValue(
  row: DomainRow,
  principal: Principal,
  includeToken: boolean
): DomainSettingsValue {
  return {
    ...row,
    verificationToken:
      principal.kind === 'session' && includeToken && row.status === 'pending'
        ? row.verificationToken
        : null,
  }
}
async function requireDomainEnterprise(organizationId: string) {
  if (isBillingEnabled && !(await isOrganizationOnEnterprisePlan(organizationId)))
    throw new OrchestrationError(
      'forbidden',
      'Domain verification is available on Enterprise plans only'
    )
}
function domainConflict(): never {
  throw new OrchestrationError(
    'conflict',
    'This domain is already verified by another organization'
  )
}
function providersOnDomain(organizationId: string, domain: string) {
  return and(
    eq(ssoProvider.organizationId, organizationId),
    sql`${ssoProviderDomainKey} = ${domain}`
  )
}
export class DomainVerificationLookupError extends OrchestrationError {
  constructor(
    readonly status: 422 | 503,
    message: string
  ) {
    super('validation', message)
  }
}

export const listOrganizationDomains = defineOrganizationConfigurationUseCase({
  operation: organizationSecurityOperations.listDomains,
  async execute({
    principal,
    input,
    context,
  }: {
    principal: Principal
    input: OrganizationInput
    context: { role: string }
  }) {
    const isEnterprise =
      !isBillingEnabled || (await isOrganizationOnEnterprisePlan(input.organizationId))
    if (!isEnterprise) return { isEnterprise: false, domains: [], truncated: false }
    const query = db
      .select()
      .from(ssoDomain)
      .where(eq(ssoDomain.organizationId, input.organizationId))
      .orderBy(asc(ssoDomain.createdAt))
    const rows =
      principal.kind === 'organization_delegated'
        ? await query.limit(MAX_ORGANIZATION_DOMAINS + 1)
        : await query
    const truncated =
      principal.kind === 'organization_delegated' && rows.length > MAX_ORGANIZATION_DOMAINS
    return {
      isEnterprise: true,
      truncated,
      domains: (truncated ? rows.slice(0, MAX_ORGANIZATION_DOMAINS) : rows).map((row) =>
        domainValue(row, principal, context.role === 'owner' || context.role === 'admin')
      ),
    }
  },
})

export const addOrganizationDomain = defineOrganizationConfigurationUseCase({
  operation: organizationSecurityOperations.addDomain,
  administratorError: 'Forbidden - Only organization owners and admins can manage domains',
  async execute({
    principal,
    input,
    context,
  }: {
    principal: Principal
    input: OrganizationInput & { domain: string }
    context: { userId: string }
  }) {
    await requireDomainEnterprise(input.organizationId)
    const domain = normalizeSSODomain(addOrganizationDomainBodySchema.parse(input).domain)
    if (!domain)
      throw new OrchestrationError('validation', 'Enter a valid domain, for example acme.com')
    const [verifiedElsewhere] = await db
      .select({ organizationId: ssoDomain.organizationId })
      .from(ssoDomain)
      .where(and(eq(ssoDomain.domain, domain), eq(ssoDomain.status, 'verified')))
      .limit(1)
    if (verifiedElsewhere && verifiedElsewhere.organizationId !== input.organizationId)
      domainConflict()
    const rows = await db
      .select()
      .from(ssoDomain)
      .where(eq(ssoDomain.organizationId, input.organizationId))
    const existing = rows.find((row) => row.domain === domain)
    if (existing) return { domain: domainValue(existing, principal, true), created: false }
    if (rows.length >= MAX_ORGANIZATION_DOMAINS)
      throw new OrchestrationError(
        'validation',
        `An organization can claim at most ${MAX_ORGANIZATION_DOMAINS} domains`
      )
    try {
      const [created] = await db
        .insert(ssoDomain)
        .values({
          id: generateId(),
          organizationId: input.organizationId,
          domain,
          status: 'pending',
          verificationToken: generateVerificationToken(),
          createdBy: context.userId,
        })
        .returning()
      if (!created) throw new Error('Domain insert returned no row')
      return { domain: domainValue(created, principal, true), created: true }
    } catch (error) {
      if (getPostgresErrorCode(error) === '23505') {
        const [winner] = await db
          .select()
          .from(ssoDomain)
          .where(
            and(eq(ssoDomain.organizationId, input.organizationId), eq(ssoDomain.domain, domain))
          )
          .limit(1)
        if (winner) return { domain: domainValue(winner, principal, true), created: false }
      }
      throw error
    }
  },
  projectAudit: ({ input, result }) =>
    result.created
      ? {
          action: AuditAction.ORGANIZATION_DOMAIN_ADDED,
          resourceType: AuditResourceType.ORGANIZATION,
          resourceId: input.organizationId,
          description: `Claimed domain ${result.domain.domain} for verification`,
          metadata: { domain: result.domain.domain },
        }
      : undefined,
})

export const removeOrganizationDomain = defineOrganizationConfigurationUseCase({
  operation: organizationSecurityOperations.removeDomain,
  administratorError: 'Forbidden - Only organization owners and admins can remove domains',
  async execute({ input }: { input: DomainInput }) {
    await requireDomainEnterprise(input.organizationId)
    const removed = await db.transaction(async (tx) => {
      const [deleted] = await tx
        .delete(ssoDomain)
        .where(
          and(eq(ssoDomain.id, input.domainId), eq(ssoDomain.organizationId, input.organizationId))
        )
        .returning({ domain: ssoDomain.domain })
      if (!deleted) return null
      await tx
        .update(ssoProvider)
        .set({ domainVerified: false })
        .where(providersOnDomain(input.organizationId, deleted.domain))
      return deleted
    })
    if (!removed) throw new OrchestrationError('not_found', 'Domain not found')
    invalidateSsoPolicyCache(input.organizationId)
    return removed
  },
  projectAudit: ({ input, result }) => ({
    action: AuditAction.ORGANIZATION_DOMAIN_REMOVED,
    resourceType: AuditResourceType.ORGANIZATION,
    resourceId: input.organizationId,
    description: `Removed domain ${result.domain}`,
    metadata: { domain: result.domain },
  }),
})

export const verifyOrganizationDomain = defineOrganizationConfigurationUseCase({
  operation: organizationSecurityOperations.verifyDomain,
  administratorError: 'Forbidden - Only organization owners and admins can verify domains',
  async execute({ principal, input }: { principal: Principal; input: DomainInput }) {
    await requireDomainEnterprise(input.organizationId)
    const [row] = await db
      .select()
      .from(ssoDomain)
      .where(
        and(eq(ssoDomain.id, input.domainId), eq(ssoDomain.organizationId, input.organizationId))
      )
      .limit(1)
    if (!row) throw new OrchestrationError('not_found', 'Domain not found')
    if (row.status === 'verified')
      return { domain: domainValue(row, principal, true), verified: false }
    const lookup = await checkDomainTxtRecord(row.domain, row.verificationToken)
    if (lookup === 'unavailable')
      throw new DomainVerificationLookupError(
        503,
        "We couldn't complete the DNS lookup, so we can't tell yet whether your record is published. Try again in a few minutes — if it keeps failing, check that your domain's nameservers are responding."
      )
    if (lookup === 'absent')
      throw new DomainVerificationLookupError(
        422,
        'The verification TXT record was not found yet. DNS changes can take up to 48 hours to propagate — add the record shown and try again.'
      )
    const [verifiedElsewhere] = await db
      .select({ organizationId: ssoDomain.organizationId })
      .from(ssoDomain)
      .where(and(eq(ssoDomain.domain, row.domain), eq(ssoDomain.status, 'verified')))
      .limit(1)
    if (verifiedElsewhere && verifiedElsewhere.organizationId !== input.organizationId)
      domainConflict()
    let updated: DomainRow[]
    try {
      updated = await db.transaction(async (tx) => {
        const flipped = await tx
          .update(ssoDomain)
          .set({ status: 'verified', verifiedAt: new Date(), updatedAt: new Date() })
          .where(
            and(
              eq(ssoDomain.id, input.domainId),
              eq(ssoDomain.organizationId, input.organizationId),
              eq(ssoDomain.verificationToken, row.verificationToken),
              eq(ssoDomain.status, 'pending')
            )
          )
          .returning()
        if (flipped.length > 0)
          await tx
            .update(ssoProvider)
            .set({ domainVerified: true })
            .where(providersOnDomain(input.organizationId, flipped[0].domain))
        return flipped
      })
    } catch (error) {
      if (getPostgresErrorCode(error) === '23505') domainConflict()
      throw error
    }
    if (!updated.length) {
      const [current] = await db
        .select()
        .from(ssoDomain)
        .where(
          and(eq(ssoDomain.id, input.domainId), eq(ssoDomain.organizationId, input.organizationId))
        )
        .limit(1)
      if (current?.status === 'verified') {
        await db
          .update(ssoProvider)
          .set({ domainVerified: true })
          .where(providersOnDomain(input.organizationId, current.domain))
        invalidateSsoPolicyCache(input.organizationId)
        return { domain: domainValue(current, principal, true), verified: false }
      }
      throw new OrchestrationError(
        'conflict',
        'The domain changed during verification. Refresh and try again.'
      )
    }
    invalidateSsoPolicyCache(input.organizationId)
    return { domain: domainValue(updated[0], principal, true), verified: true }
  },
  projectAudit: ({ input, result }) =>
    result.verified
      ? {
          action: AuditAction.ORGANIZATION_DOMAIN_VERIFIED,
          resourceType: AuditResourceType.ORGANIZATION,
          resourceId: input.organizationId,
          description: `Verified domain ${result.domain.domain}`,
          metadata: { domain: result.domain.domain },
        }
      : undefined,
})

/** Verification tokens never enter the model, including for administrator delegates. */
export function projectOrganizationDomainForTool(row: DomainSettingsValue) {
  return {
    id: row.id,
    domain: row.domain,
    status: row.status,
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    challengeHost: buildChallengeHost(row.domain),
  }
}
