import { AuditAction, AuditResourceType } from '@sim/audit'
import type { Principal } from '@sim/auth/principal'
import { db, ssoDomain, ssoProvider } from '@sim/db'
import {
  forgetPrimaryProvider,
  isNamedPrimary,
  ssoProviderDomainKey,
  verifiedDomainOfProvider,
} from '@sim/db/sso-primary-provider'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import {
  type CursorKey,
  keysetColumns,
  keysetPage,
  type ListSortOrder,
  listOrderBy,
  resumeKeyset,
  textKey,
} from '@/lib/api/list-query'
import { ssoProviderOperations } from '@/lib/auth/sso/application/operations'
import { markSignInProviders } from '@/lib/auth/sso/primary-provider'
import { lockSsoProvider } from '@/lib/auth/sso/provider-lock'
import { invalidateSsoPolicyCache } from '@/lib/auth/sso-policy'
import { acquireOrganizationMutationLock } from '@/lib/billing/organizations/membership'
import { recordProjectedUseCaseAuditEntries } from '@/lib/core/application/authorized-workspace-use-case'
import { ForbiddenOperationError } from '@/lib/core/application/forbidden'
import { requireOAuthOperationScope } from '@/lib/core/application/oauth-authorization'
import type { OperationUseCase } from '@/lib/core/application/operation'
import { authorizeOrganizationOperation } from '@/lib/core/application/organization-authorization'
import { PrincipalKindAuthorizationError } from '@/lib/core/application/workspace-authorization'
import type { OrchestrationRequestContext } from '@/lib/core/orchestration/types'
import { OrchestrationError } from '@/lib/core/orchestration/types'

interface ProviderScope {
  organizationId?: string
  providerId?: string
}
interface ProviderListInput extends ProviderScope {
  limit?: number
  sortBy?: 'providerId' | 'domain'
  sortOrder?: ListSortOrder
  cursorKeys?: CursorKey[]
}

function requireProviderPrincipal(
  principal: Principal,
  operation: typeof ssoProviderOperations.list | typeof ssoProviderOperations.delete
) {
  if (!operation.principalKinds.some((kind) => kind === principal.kind))
    throw new PrincipalKindAuthorizationError(principal.kind, operation.id)
  requireOAuthOperationScope(principal, operation)
}

async function loadProviders(principal: Principal, input: ProviderListInput) {
  requireProviderPrincipal(principal, ssoProviderOperations.list)
  const ownership = input.organizationId
    ? eq(
        ssoProvider.organizationId,
        (
          await authorizeOrganizationOperation(principal, ssoProviderOperations.list, {
            organizationId: input.organizationId,
          })
        ).organizationId
      )
    : principal.kind === 'session'
      ? eq(ssoProvider.userId, principal.userId)
      : undefined
  if (!ownership) throw new OrchestrationError('validation', 'organizationId is required')

  if (input.limit === undefined) {
    const rows = await db
      .select({
        id: ssoProvider.id,
        providerId: ssoProvider.providerId,
        domain: ssoProvider.domain,
        issuer: ssoProvider.issuer,
        oidcConfig: ssoProvider.oidcConfig,
        samlConfig: ssoProvider.samlConfig,
        userId: ssoProvider.userId,
        organizationId: ssoProvider.organizationId,
        jitProvisioningEnabled: ssoProvider.jitProvisioningEnabled,
        domainVerified: ssoProvider.domainVerified,
        domainKey: ssoProviderDomainKey,
        isNamedPrimary,
      })
      .from(ssoProvider)
      .leftJoin(ssoDomain, verifiedDomainOfProvider)
      .where(ownership)
      .orderBy(asc(ssoProvider.providerId))
    return { providers: markSignInProviders(rows), nextCursorKeys: null }
  }
  const providers = db
    .select({
      id: ssoProvider.id,
      providerId: ssoProvider.providerId,
      domain: ssoProvider.domain,
      issuer: ssoProvider.issuer,
      oidcConfig: ssoProvider.oidcConfig,
      samlConfig: ssoProvider.samlConfig,
      userId: ssoProvider.userId,
      organizationId: ssoProvider.organizationId,
      jitProvisioningEnabled: ssoProvider.jitProvisioningEnabled,
      domainVerified: ssoProvider.domainVerified,
      domainKey: ssoProviderDomainKey.as('domain_key'),
      isPrimary:
        sql<boolean>`${ssoProvider.domainVerified} and ${ssoProvider.providerId} = first_value(${ssoProvider.providerId}) over (
      partition by ${ssoProviderDomainKey} order by case when ${ssoProvider.domainVerified} and ${isNamedPrimary} then 0 when ${ssoProvider.domainVerified} then 1 else 2 end, ${ssoProvider.providerId}
    )`.as('is_primary'),
    })
    .from(ssoProvider)
    .leftJoin(ssoDomain, verifiedDomainOfProvider)
    .where(ownership)
    .as('sso_settings')
  const sortKeys = [
    input.sortBy === 'domain'
      ? textKey(providers.domain, (row: SsoProviderSettings) => row.domain)
      : textKey(providers.providerId, (row: SsoProviderSettings) => row.providerId),
    textKey(providers.id, (row: SsoProviderSettings) => row.id),
  ]
  const query = db
    .select()
    .from(providers)
    .where(
      and(
        input.providerId ? eq(providers.providerId, input.providerId) : undefined,
        resumeKeyset(sortKeys, input.cursorKeys, input.sortOrder ?? 'asc')
      )
    )
    .orderBy(...listOrderBy(keysetColumns(sortKeys), input.sortOrder ?? 'asc'))
  const rows = input.limit === undefined ? await query : await query.limit(input.limit + 1)
  const page = keysetPage(sortKeys, rows, input.limit)
  return { providers: page.data, nextCursorKeys: page.nextCursorKeys }
}

export interface SsoProviderSettings {
  id: string
  providerId: string
  domain: string
  issuer: string
  oidcConfig: string | null
  samlConfig: string | null
  userId: string
  organizationId: string | null
  jitProvisioningEnabled: boolean
  domainVerified: boolean
  domainKey: string
  isPrimary: boolean
}

export const listSsoProviders: OperationUseCase<
  typeof ssoProviderOperations.list,
  ProviderListInput,
  Awaited<ReturnType<typeof loadProviders>>
> = {
  operation: ssoProviderOperations.list,
  execute: ({ principal, input }) => loadProviders(principal, input),
}

async function executeDeleteProvider(
  principal: Principal,
  input: { organizationId?: string; providerId: string },
  request?: OrchestrationRequestContext
) {
  requireProviderPrincipal(principal, ssoProviderOperations.delete)
  const [provider] = await db
    .select()
    .from(ssoProvider)
    .where(eq(ssoProvider.providerId, input.providerId))
    .limit(1)
  if (!provider || (input.organizationId && provider.organizationId !== input.organizationId))
    throw new OrchestrationError('not_found', 'Provider not found')
  if (provider.organizationId) {
    await authorizeOrganizationOperation(principal, ssoProviderOperations.delete, {
      organizationId: provider.organizationId,
    })
  } else if (principal.kind !== 'session' || provider.userId !== principal.userId) {
    if (principal.kind === 'session')
      throw new ForbiddenOperationError('ORGANIZATION_ADMIN_REQUIRED', 'Forbidden')
    throw new OrchestrationError('not_found', 'Provider not found')
  }
  const ownerClause = provider.organizationId
    ? eq(ssoProvider.organizationId, provider.organizationId)
    : and(eq(ssoProvider.userId, provider.userId), isNull(ssoProvider.organizationId))
  const removed = await db.transaction(async (tx) => {
    if (provider.organizationId) {
      await acquireOrganizationMutationLock(tx, provider.organizationId)
    }
    await lockSsoProvider(tx, provider.providerId)
    if (provider.organizationId) {
      await authorizeOrganizationOperation(
        principal,
        ssoProviderOperations.delete,
        { organizationId: provider.organizationId },
        { executor: tx, forUpdate: true }
      )
    }
    const deleted = await tx
      .delete(ssoProvider)
      .where(and(eq(ssoProvider.id, provider.id), ownerClause))
      .returning({
        id: ssoProvider.id,
        providerId: ssoProvider.providerId,
        organizationId: ssoProvider.organizationId,
        domain: ssoProvider.domain,
      })
    if (deleted.length && provider.organizationId)
      await forgetPrimaryProvider(tx, provider.organizationId, provider.providerId)
    return deleted
  })
  const deleted = removed[0]
  if (!deleted) throw new OrchestrationError('not_found', 'Provider not found')
  if (deleted.organizationId) {
    invalidateSsoPolicyCache(deleted.organizationId)
    recordProjectedUseCaseAuditEntries(
      ssoProviderOperations.delete,
      null,
      principal,
      request,
      [
        {
          action: AuditAction.ORGANIZATION_SSO_PROVIDER_DELETED,
          resourceType: AuditResourceType.ORGANIZATION,
          resourceId: deleted.organizationId,
          description: 'Deleted organization SSO provider',
          metadata: { providerId: deleted.providerId, domain: deleted.domain },
        },
      ],
      deleted.organizationId
    )
  }
  return { providerId: deleted.providerId }
}

export const deleteSsoProvider: OperationUseCase<
  typeof ssoProviderOperations.delete,
  { organizationId?: string; providerId: string },
  { providerId: string }
> = {
  operation: ssoProviderOperations.delete,
  execute: ({ principal, input, request }) => executeDeleteProvider(principal, input, request),
}

export const getSsoProvider: OperationUseCase<
  typeof ssoProviderOperations.list,
  { organizationId: string; providerId: string },
  SsoProviderSettings
> = {
  operation: ssoProviderOperations.list,
  async execute({ principal, input }) {
    const result = await loadProviders(principal, { ...input, limit: 1 })
    const provider = result.providers[0]
    if (!provider) throw new OrchestrationError('not_found', 'Provider not found')
    return provider
  },
}
