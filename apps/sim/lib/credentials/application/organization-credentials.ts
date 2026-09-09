import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { account, credential } from '@sim/db/schema'
import { and, desc, eq, getTableColumns, or } from 'drizzle-orm'
import type {
  CreateOrganizationCredentialBody,
  CreateOrganizationCredentialDraftBody,
  OrganizationCredentialsQuery,
  UpdateOrganizationCredentialBody,
} from '@/lib/api/contracts/organization-credentials'
import type { OperationUseCase } from '@/lib/core/application/operation'
import {
  authorizeOrganizationOperation,
  requireOrganizationMembership,
} from '@/lib/core/application/organization-authorization'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { resourceScopeCondition } from '@/lib/core/resource-scope.server'
import { throwCredentialMutationFailure } from '@/lib/credentials/application/credential-crud'
import {
  listCredentialProviderCatalog,
  requireAvailableOAuthCredentialProvider,
  requireAvailableServiceAccountCredentialProvider,
} from '@/lib/credentials/application/provider-catalog'
import { createConnectDraft, getActiveConnectDraft } from '@/lib/credentials/connect-draft'
import { updateCredentialRecord } from '@/lib/credentials/orchestration'
import { createCredentialRecord } from '@/lib/credentials/orchestration/credential-create'
import { getOrganizationCredential } from '@/lib/credentials/organization'
import type { CredentialRow } from '@/lib/credentials/queries'
import { resolveCredentialTokenBundle } from '@/lib/oauth/credential-service'
import { getServiceConfigByProviderId } from '@/lib/oauth/utils'

export const organizationCredentialOperations = {
  list: defineOrganizationOperation({
    id: 'organization_credentials.list',
    oauthScope: 'api:read',
    minimumRole: 'admin',
    principalKinds: ['session', 'personal_api_key', 'oauth_access_token'],
    capability: 'integrations.manage',
  }),
  create: defineOrganizationOperation({
    id: 'organization_credentials.create',
    oauthScope: 'api:write',
    minimumRole: 'admin',
    principalKinds: ['session', 'personal_api_key', 'oauth_access_token'],
    capability: 'integrations.manage',
  }),
  update: defineOrganizationOperation({
    id: 'organization_credentials.update',
    oauthScope: 'api:write',
    minimumRole: 'admin',
    principalKinds: ['session', 'personal_api_key', 'oauth_access_token'],
    capability: 'integrations.manage',
  }),
  saveDraft: defineOrganizationOperation({
    id: 'organization_credentials.drafts.save',
    oauthScope: 'api:write',
    minimumRole: 'admin',
    principalKinds: ['session', 'personal_api_key', 'oauth_access_token'],
    capability: 'integrations.manage',
  }),
  launch: defineOrganizationOperation({
    id: 'organization_credentials.connections.launch',
    oauthScope: 'api:write',
    minimumRole: 'admin',
    principalKinds: ['session', 'personal_api_key', 'oauth_access_token'],
    capability: 'integrations.manage',
  }),
  use: defineOrganizationOperation({
    id: 'organization_credentials.use',
    oauthScope: 'api:read',
    minimumRole: 'admin',
    principalKinds: ['session', 'personal_api_key', 'oauth_access_token'],
    capability: 'integrations.manage',
  }),
} as const

export const listOrganizationCredentials: OperationUseCase<
  typeof organizationCredentialOperations.list,
  OrganizationCredentialsQuery,
  { credentials: (CredentialRow & { scopes: string[] })[] }
> = {
  operation: organizationCredentialOperations.list,
  async execute({ principal, input }) {
    const context = await authorizeOrganizationOperation(
      principal,
      organizationCredentialOperations.list,
      input
    )
    const catalog = await listCredentialProviderCatalog(principal, input)
    const rows = await db
      .select({ ...getTableColumns(credential), accountScope: account.scope })
      .from(credential)
      .leftJoin(account, eq(credential.accountId, account.id))
      .where(
        and(
          resourceScopeCondition(credential, {
            kind: 'organization',
            organizationId: input.organizationId,
          }),
          or(
            eq(credential.type, 'service_account'),
            and(eq(credential.type, 'oauth'), eq(credential.createdBy, context.userId))
          ),
          ...(input.type ? [eq(credential.type, input.type)] : []),
          ...(input.providerId ? [eq(credential.providerId, input.providerId)] : [])
        )
      )
      .orderBy(desc(credential.createdAt))
      .limit(1000)
    return {
      credentials: rows
        .filter((row) => {
          if (!row.providerId) return false
          return catalog.some(
            (entry) =>
              entry.available &&
              (entry.type === 'service_account'
                ? entry.providerId === row.providerId
                : entry.authorizationOptions.some((option) => option.providerId === row.providerId))
          )
        })
        .map(({ accountScope, ...row }) => ({
          ...row,
          scopes: row.type === 'oauth' ? (accountScope?.split(/[\s,]+/).filter(Boolean) ?? []) : [],
        })),
    }
  },
}

export const createOrganizationCredential: OperationUseCase<
  typeof organizationCredentialOperations.create,
  CreateOrganizationCredentialBody,
  { credential: CredentialRow; created: boolean }
> = {
  operation: organizationCredentialOperations.create,
  async execute({ principal, input, request }) {
    const context = await authorizeOrganizationOperation(
      principal,
      organizationCredentialOperations.create,
      input
    )
    const catalog = await listCredentialProviderCatalog(principal, input)
    if (input.type === 'service_account')
      requireAvailableServiceAccountCredentialProvider(catalog, input.providerId ?? '')
    else {
      await requireOrganizationMembership(
        principal,
        input.organizationId,
        'admin',
        'credentials.personal'
      )
      requireAvailableOAuthCredentialProvider(catalog, input.providerId ?? '')
    }
    const result = await createCredentialRecord(
      { ...input, userId: context.userId },
      { authorizeWorkspace: false }
    )
    if (!result.success) throwCredentialMutationFailure(result)
    if (!result.credential) throw new Error('Credential creation returned no credential')
    if (result.created)
      recordAudit({
        actorId: context.userId,
        action: AuditAction.CREDENTIAL_CREATED,
        resourceType: AuditResourceType.CREDENTIAL,
        resourceId: result.credential.id,
        resourceName: result.credential.displayName,
        description: `Created ${result.credential.type} credential "${result.credential.displayName}"`,
        metadata: {
          ...result.auditMetadata,
          organizationId: input.organizationId,
          providerId: result.credential.providerId,
        },
        request,
      })
    return { credential: result.credential, created: result.created === true }
  },
}

async function requireOrganizationConnectionTarget(
  principal: Principal,
  input: { organizationId: string; providerId: string; credentialId?: string },
  userId: string
) {
  if (!input.credentialId)
    await requireOrganizationMembership(
      principal,
      input.organizationId,
      'admin',
      'credentials.personal'
    )
  const catalog = await listCredentialProviderCatalog(principal, input)
  requireAvailableOAuthCredentialProvider(catalog, input.providerId)
  if (input.credentialId) {
    const row = await getOrganizationCredential(input.organizationId, input.credentialId)
    if (!row || row.type !== 'oauth' || row.createdBy !== userId)
      throw new OrchestrationError('not_found', 'OAuth credential not found')
    if (row.providerId !== input.providerId)
      throw new OrchestrationError('validation', 'OAuth provider does not match this credential')
  }
}

export const saveOrganizationCredentialDraft: OperationUseCase<
  typeof organizationCredentialOperations.saveDraft,
  CreateOrganizationCredentialDraftBody,
  { success: true; draftId: string }
> = {
  operation: organizationCredentialOperations.saveDraft,
  async execute({ principal, input }) {
    const context = await authorizeOrganizationOperation(
      principal,
      organizationCredentialOperations.saveDraft,
      input
    )
    await requireOrganizationConnectionTarget(principal, input, context.userId)
    const draft = await createConnectDraft({ ...input, userId: context.userId })
    return { success: true, draftId: draft.id }
  },
}

export async function launchOrganizationCredentialConnection(
  principal: Principal,
  draftId: string
) {
  if (principal.kind !== 'session')
    throw new OrchestrationError('forbidden', 'Sign in to connect an account')
  const draft = await getActiveConnectDraft(draftId, principal.userId)
  if (!draft?.organizationId || draft.workspaceId)
    throw new OrchestrationError('not_found', 'OAuth connection link is invalid or expired')
  const context = await authorizeOrganizationOperation(
    principal,
    organizationCredentialOperations.launch,
    { organizationId: draft.organizationId }
  )
  await requireOrganizationConnectionTarget(
    principal,
    {
      organizationId: draft.organizationId,
      providerId: draft.providerId,
      credentialId: draft.credentialId ?? undefined,
    },
    context.userId
  )
  return { draft }
}

/** Organization setup selectors use a canonical credential after current admin authorization. */
export async function authorizeOrganizationCredentialUse(input: {
  principal: Principal
  organizationId: string
  credentialId: string
  requestId: string
  requiredScopes?: string[]
  expectedProviderId?: string
  impersonateEmail?: string
}) {
  const context = await authorizeOrganizationOperation(
    input.principal,
    organizationCredentialOperations.use,
    input
  )
  const row = await getOrganizationCredential(input.organizationId, input.credentialId)
  if (
    !row ||
    (row.type !== 'oauth' && row.type !== 'service_account') ||
    !row.providerId ||
    (row.type === 'oauth' && row.createdBy !== context.userId)
  ) {
    throw new OrchestrationError('not_found', 'Credential not found')
  }
  const catalog = await listCredentialProviderCatalog(input.principal, input)
  if (row.type === 'service_account')
    requireAvailableServiceAccountCredentialProvider(catalog, row.providerId)
  else requireAvailableOAuthCredentialProvider(catalog, row.providerId)
  if (
    input.expectedProviderId &&
    row.providerId !== input.expectedProviderId &&
    !(
      row.type === 'service_account' &&
      getServiceConfigByProviderId(input.expectedProviderId)?.serviceAccountProviderId ===
        row.providerId
    )
  ) {
    throw new OrchestrationError('validation', 'Credential provider does not match the source')
  }
  return { credential: row, userId: context.userId }
}

export async function resolveOrganizationCredentialTokenBundle(
  input: Parameters<typeof authorizeOrganizationCredentialUse>[0]
) {
  const { credential: row, userId } = await authorizeOrganizationCredentialUse(input)
  return resolveCredentialTokenBundle(
    row.id,
    userId,
    input.requestId,
    input.requiredScopes,
    input.impersonateEmail,
    { privacyMode: 'selector' }
  )
}

export const updateOrganizationCredential: OperationUseCase<
  typeof organizationCredentialOperations.update,
  UpdateOrganizationCredentialBody & { credentialId: string },
  { credential: CredentialRow }
> = {
  operation: organizationCredentialOperations.update,
  async execute({ principal, input, request }) {
    const context = await authorizeOrganizationOperation(
      principal,
      organizationCredentialOperations.update,
      input
    )
    const row = await getOrganizationCredential(input.organizationId, input.credentialId)
    if (
      !row ||
      (row.type !== 'oauth' && row.type !== 'service_account') ||
      (row.type === 'oauth' && row.createdBy !== context.userId)
    )
      throw new OrchestrationError('not_found', 'Credential not found')
    const result = await updateCredentialRecord({ ...input, credential: row })
    if (!result.success) throwCredentialMutationFailure(result)
    const updated = await getOrganizationCredential(input.organizationId, input.credentialId)
    if (!updated) throw new OrchestrationError('not_found', 'Credential not found')
    recordAudit({
      actorId: context.userId,
      action: AuditAction.CREDENTIAL_UPDATED,
      resourceType: AuditResourceType.CREDENTIAL,
      resourceId: row.id,
      resourceName: updated.displayName,
      description: `Updated credential "${updated.displayName}"`,
      metadata: {
        ...result.auditMetadata,
        organizationId: input.organizationId,
        updatedFields: result.updatedFields,
      },
      request,
    })
    return { credential: updated }
  },
}
