import { AuditAction, AuditResourceType } from '@sim/audit'
import { db } from '@sim/db'
import { credential, credentialMember, user } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, count, eq, inArray, isNull } from 'drizzle-orm'
import type { SaveSearchPersonalCredentialBody } from '@/lib/api/contracts/search-personal-credentials'
import { acquireOrganizationUserMutationLocks } from '@/lib/billing/organizations/membership'
import { recordProjectedUseCaseAuditEntries } from '@/lib/core/application'
import type { OperationUseCase } from '@/lib/core/application/operation'
import { authorizeOrganizationOperation } from '@/lib/core/application/organization-authorization'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { withResourceOutboundScope } from '@/lib/core/network/resource-scope.server'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { ORGANIZATION_VIEWER_ACCOUNT_LIMIT } from '@/lib/credential-groups/limits'
import { CredentialProviderOperationError } from '@/lib/credentials/application/crud'
import {
  listCredentialProviderCatalog,
  requireAvailableServiceAccountCredentialProvider,
} from '@/lib/credentials/application/provider-catalog'
import { verifyAndBuildServiceAccountSecret } from '@/lib/credentials/service-account-secret'
import { TokenServiceAccountValidationError } from '@/lib/credentials/token-service-accounts/errors'
import { normalizeFlowOrigin, normalizeFlowWorkspaceId } from '@/lib/flow/client'
import { normalizeJamaInstanceUrl } from '@/lib/jama/client'
import {
  listOrganizationSearchApprovals,
  lockOrganizationSearchApproval,
  requireOrganizationSearchApproval,
} from '@/lib/knowledge/search/integration-policy'
import { SAVED_MEMBER_SEARCH_PROVIDER_IDS } from '@/lib/sim-search/live/provider-catalog'
import { isSearchProviderEnabled } from '@/lib/sim-search/live/provider-rollout'

const searchPersonalCredentialOperations = {
  save: defineOrganizationOperation({
    id: 'search.personal_credentials.save',
    minimumRole: 'member',
    principalKinds: ['session'],
    capability: 'integrations.manage',
  }),
  remove: defineOrganizationOperation({
    id: 'search.personal_credentials.remove',
    minimumRole: 'member',
    principalKinds: ['session'],
    capability: 'integrations.manage',
  }),
} as const

function ownedCredential(organizationId: string, userId: string, credentialId: string) {
  return and(
    eq(credential.id, credentialId),
    eq(credential.organizationId, organizationId),
    isNull(credential.workspaceId),
    eq(credential.createdBy, userId),
    eq(credential.type, 'service_account')
  )
}

/** Personal Search accepts only the connecting member's freshly verified provider identity. */
export const saveSearchPersonalCredential: OperationUseCase<
  typeof searchPersonalCredentialOperations.save,
  SaveSearchPersonalCredentialBody,
  { credentialId: string }
> = {
  operation: searchPersonalCredentialOperations.save,
  async execute({ principal, input, request }) {
    const context = await authorizeOrganizationOperation(principal, this.operation, input)
    const provider = input.providerId === 'jama-service-account' ? 'jama' : 'flow'
    await requireOrganizationSearchApproval(context.organizationId, provider)
    if (
      !(await isSearchProviderEnabled(provider, {
        kind: 'organization',
        organizationId: context.organizationId,
      }))
    ) {
      throw new OrchestrationError('forbidden', 'This Search integration is unavailable')
    }
    requireAvailableServiceAccountCredentialProvider(
      await listCredentialProviderCatalog(principal, context),
      input.providerId
    )
    if (input.credentialId) {
      const [existing] = await db
        .select({ providerId: credential.providerId })
        .from(credential)
        .where(ownedCredential(context.organizationId, context.userId, input.credentialId))
        .limit(1)
      if (existing?.providerId !== input.providerId) {
        throw new OrchestrationError('not_found', 'Personal connection not found')
      }
    }
    let verified
    try {
      verified = await withResourceOutboundScope(context, () =>
        verifyAndBuildServiceAccountSecret(input.providerId, input)
      )
    } catch (error) {
      if (!(error instanceof TokenServiceAccountValidationError)) throw error
      throw new CredentialProviderOperationError(
        'Could not verify your provider credentials. Check the connection details and try again.',
        error.code,
        error.code === 'provider_unavailable'
      )
    }
    const tenantId =
      input.providerId === 'jama-service-account'
        ? normalizeJamaInstanceUrl(input.orgId ?? '')
        : JSON.stringify([
            normalizeFlowOrigin(input.domain),
            normalizeFlowWorkspaceId(input.providerWorkspaceId ?? ''),
          ])
    const providerEmail =
      verified.principal?.kind === 'user'
        ? verified.principal.label?.trim().toLowerCase()
        : undefined
    const result = await db.transaction(async (tx) => {
      await lockOrganizationSearchApproval(tx, context.organizationId)
      await acquireOrganizationUserMutationLocks(tx, {
        userId: context.userId,
        organizationIds: [context.organizationId],
      })
      await authorizeOrganizationOperation(principal, this.operation, input, {
        executor: tx,
        forShare: true,
      })
      if (
        (await listOrganizationSearchApprovals(context.organizationId, tx)).get(provider) !== true
      ) {
        throw new OrchestrationError('forbidden', 'This Search integration is no longer approved')
      }
      const [person] = await tx
        .select({ email: user.email, verified: user.emailVerified })
        .from(user)
        .where(eq(user.id, context.userId))
        .for('share')
        .limit(1)
      if (
        !person?.verified ||
        !providerEmail ||
        providerEmail !== person.email.trim().toLowerCase()
      ) {
        throw new OrchestrationError(
          'validation',
          'Use your own provider account with the same email as your verified Sim account'
        )
      }
      if (input.credentialId) {
        const [existing] = await tx
          .select({
            tenantId: credential.providerTenantId,
            subjectId: credential.providerSubjectId,
          })
          .from(credential)
          .where(ownedCredential(context.organizationId, context.userId, input.credentialId))
          .for('update')
          .limit(1)
        if (
          !existing ||
          existing.tenantId !== tenantId ||
          verified.principal?.kind !== 'user' ||
          existing.subjectId !== verified.principal.id
        ) {
          throw new OrchestrationError(
            'validation',
            'Reconnect with the same provider account and workspace. Add a new connection to use a different account.'
          )
        }
      }
      const now = new Date()
      const credentialId = input.credentialId ?? generateId()
      const fields = {
        displayName: input.displayName?.trim() || verified.displayName,
        description: input.description?.trim() || null,
        encryptedServiceAccountKey: verified.encryptedServiceAccountKey,
        providerSubjectId: verified.principal?.kind === 'user' ? verified.principal.id : null,
        providerTenantId: tenantId,
        revokedAt: null,
        updatedAt: now,
      }
      if (input.credentialId) {
        const updated = await tx
          .update(credential)
          .set(fields)
          .where(
            and(
              ownedCredential(context.organizationId, context.userId, credentialId),
              eq(credential.providerId, input.providerId)
            )
          )
          .returning({ id: credential.id })
        if (!updated.length)
          throw new OrchestrationError('not_found', 'Personal connection not found')
      } else {
        const [saved] = await tx
          .select({ count: count() })
          .from(credential)
          .where(
            and(
              eq(credential.organizationId, context.organizationId),
              isNull(credential.workspaceId),
              eq(credential.createdBy, context.userId),
              eq(credential.type, 'service_account'),
              inArray(credential.providerId, SAVED_MEMBER_SEARCH_PROVIDER_IDS),
              isNull(credential.revokedAt)
            )
          )
        if (saved.count >= ORGANIZATION_VIEWER_ACCOUNT_LIMIT) {
          throw new OrchestrationError(
            'validation',
            'Remove an unused personal Search connection before adding another'
          )
        }
        await tx.insert(credential).values({
          id: credentialId,
          organizationId: context.organizationId,
          type: 'service_account',
          providerId: input.providerId,
          createdBy: context.userId,
          ...fields,
        })
        await tx.insert(credentialMember).values({
          id: generateId(),
          credentialId,
          userId: context.userId,
          role: 'admin',
          status: 'active',
          joinedAt: now,
        })
      }
      return { credentialId }
    })
    recordProjectedUseCaseAuditEntries(
      this.operation,
      null,
      principal,
      request,
      [
        {
          action: input.credentialId
            ? AuditAction.CREDENTIAL_UPDATED
            : AuditAction.CREDENTIAL_CREATED,
          resourceType: AuditResourceType.CREDENTIAL,
          resourceId: result.credentialId,
          metadata: { providerId: input.providerId, ...verified.auditMetadata },
        },
      ],
      context.organizationId
    )
    return result
  },
}

export const removeSearchPersonalCredential: OperationUseCase<
  typeof searchPersonalCredentialOperations.remove,
  { organizationId: string; credentialId: string },
  { success: true }
> = {
  operation: searchPersonalCredentialOperations.remove,
  async execute({ principal, input, request }) {
    const context = await authorizeOrganizationOperation(principal, this.operation, input)
    await db.transaction(async (tx) => {
      await acquireOrganizationUserMutationLocks(tx, {
        userId: context.userId,
        organizationIds: [context.organizationId],
      })
      await authorizeOrganizationOperation(principal, this.operation, input, {
        executor: tx,
        forShare: true,
      })
      const [row] = await tx
        .select({ providerId: credential.providerId })
        .from(credential)
        .where(ownedCredential(context.organizationId, context.userId, input.credentialId))
        .for('update')
        .limit(1)
      if (
        row?.providerId !== 'jama-service-account' &&
        row?.providerId !== 'flow-service-account'
      ) {
        throw new OrchestrationError('not_found', 'Personal connection not found')
      }
      await tx
        .delete(credential)
        .where(ownedCredential(context.organizationId, context.userId, input.credentialId))
    })
    recordProjectedUseCaseAuditEntries(
      this.operation,
      null,
      principal,
      request,
      [
        {
          action: AuditAction.CREDENTIAL_DELETED,
          resourceType: AuditResourceType.CREDENTIAL,
          resourceId: input.credentialId,
        },
      ],
      context.organizationId
    )
    return { success: true }
  },
}
