import { AuditAction, AuditResourceType } from '@sim/audit'
import { type Principal, resolvePrincipalSubjectUserId } from '@sim/auth/principal'
import { isPlainRecord } from '@sim/utils/object'
import type { BillingAttributionSnapshot } from '@/lib/billing/core/billing-attribution'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  resourceScopeFields,
  resourceScopeFromOwner,
  sameResourceScope,
} from '@/lib/core/resource-scope'
import { generateRequestId } from '@/lib/core/utils/request'
import { loadScopedAccountsCredentialListContext } from '@/lib/credential-groups/credentials'
import { createViewerCredentialGroupEnrollment } from '@/lib/credential-groups/self-enrollment'
import {
  requireKnowledgeMemberAccessAvailable,
  requireSourceMirroredAccessAvailable,
} from '@/lib/knowledge/access/availability'
import { defineAuthorizedKnowledgeUseCase } from '@/lib/knowledge/application/authorized-knowledge-use-case'
import {
  resolveKnowledgeAttributedUserId,
  resolveKnowledgeBillingAttribution,
} from '@/lib/knowledge/application/billing'
import {
  requireSuccessfulOutcome,
  resolveConnectorCredentialAccessToken,
  validateConnectorSourceConfig,
} from '@/lib/knowledge/application/connectors'
import { resolveActiveKnowledgeConnectorContext } from '@/lib/knowledge/application/contexts'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import {
  type ConnectorAccessMode,
  mirrorsSourceAcls,
} from '@/lib/knowledge/connectors/access-modes'
import { validateKnowledgeConnectorMembersBinding } from '@/lib/knowledge/connectors/member-access'
import {
  provisionKnowledgeConnectorMembersBinding,
  sourceIdentityBinding,
} from '@/lib/knowledge/connectors/member-provisioning'
import { assertConnectorMirrorsSourceAcls } from '@/lib/knowledge/connectors/mirrored-access'
import {
  type ConnectorAccessTarget,
  performUpdateKnowledgeConnectorAccess,
  resolveKnowledgeConnectorMembersBinding,
} from '@/lib/knowledge/orchestration/connector-access'
import { getKnowledgeConnector } from '@/lib/knowledge/orchestration/connectors'
import type { KnowledgeOperationSource } from '@/lib/knowledge/orchestration/shared'
import { requireOrganizationSearchApproval } from '@/lib/knowledge/search/integration-policy'
import { getServiceConfigByProviderId, getServiceConfigByServiceId } from '@/lib/oauth'
import { getConnectorMeta } from '@/connectors/registry'
import type { ConnectorMeta } from '@/connectors/types'

export interface StartKnowledgeConnectorMemberEnrollmentInput {
  knowledgeBaseId: string
  connectorId: string
  assertedWorkspaceId?: string
  assertedOrganizationId?: string
}

/**
 * Hands a workspace member the link that connects their own account to a
 * source, for a per-member crawl or to identify them in mirrored ACLs.
 * This creates no crawler grants and only changes what the member themselves can see.
 */
export const startKnowledgeConnectorMemberEnrollment = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.enrollConnectorMember,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Principal
    input: StartKnowledgeConnectorMemberEnrollmentInput
  }) => resolveActiveKnowledgeConnectorContext(input, principal),
  async execute({ principal, context }) {
    const owner = resourceScopeFields(resourceScopeFromOwner(context.knowledgeBase))
    const userId = resolvePrincipalSubjectUserId(principal)
    if (!userId) throw new OrchestrationError('forbidden', 'Sign in to connect your account')
    const connector = await getKnowledgeConnector(context.knowledgeBaseId, context.connectorId)
    if (!connector) throw new OrchestrationError('not_found', 'Connector not found')
    if (owner.organizationId && context.knowledgeBase.isSearchIndex) {
      await requireOrganizationSearchApproval(owner.organizationId, connector.connectorType)
    }
    await requireKnowledgeMemberAccessAvailable(owner)
    const connectorMeta = getConnectorMeta(connector.connectorType)
    if (!connectorMeta || (context.knowledgeBase.isSearchIndex && !connectorMeta.search)) {
      throw new OrchestrationError('validation', 'This connector is unavailable for Search')
    }
    const enrollmentUrl = (invitationLink: string, optionId: string) => {
      if (!context.knowledgeBase.isSearchIndex) return invitationLink
      const url = new URL(invitationLink)
      url.searchParams.set('optionId', optionId)
      url.searchParams.set('returnTo', 'search')
      return url.toString()
    }
    if (connector.accessMode === 'admin') {
      await requireSourceMirroredAccessAvailable(owner)
      const group = await loadScopedAccountsCredentialListContext(resourceScopeFromOwner(owner))
      const binding = sourceIdentityBinding(connectorMeta, group)
      if (!binding) {
        throw new OrchestrationError(
          'validation',
          `Ask an admin to configure ${connectorMeta.name} sign-in in Connected accounts`
        )
      }
      const { invitationLink: url } = await createViewerCredentialGroupEnrollment({
        userId,
        ...owner,
        credentialGroupId: binding.credentialGroupId,
      })
      return { url: enrollmentUrl(url, binding.credentialGroupOptionId) }
    }
    if (
      connector.accessMode !== 'members' ||
      !connector.credentialGroupId ||
      !connector.credentialGroupOptionId
    ) {
      throw new OrchestrationError('validation', 'This connector does not sync per member')
    }
    if (!isPlainRecord(connector.sourceConfig)) {
      throw new OrchestrationError('validation', 'This connector has invalid source settings')
    }
    const group = await loadScopedAccountsCredentialListContext(
      resourceScopeFromOwner(owner),
      connector.credentialGroupId
    )
    if (
      !group ||
      group.credentialGroupId !== connector.credentialGroupId ||
      !sameResourceScope(resourceScopeFromOwner(group), resourceScopeFromOwner(owner))
    ) {
      throw new OrchestrationError(
        'validation',
        'Connected accounts was not found in this organization or workspace'
      )
    }
    const validation = validateKnowledgeConnectorMembersBinding({
      connectorMeta,
      group,
      credentialGroupOptionId: connector.credentialGroupOptionId,
      sourceConfig: connector.sourceConfig,
    })
    if (!validation.ok) throw new OrchestrationError('validation', validation.message)
    const { invitationLink: url } = await createViewerCredentialGroupEnrollment({
      userId,
      ...owner,
      credentialGroupId: connector.credentialGroupId,
    })
    return { url: enrollmentUrl(url, connector.credentialGroupOptionId) }
  },
})

export interface UpdateKnowledgeConnectorAccessInput {
  knowledgeBaseId: string
  connectorId: string
  assertedWorkspaceId?: string
  assertedOrganizationId?: string
  accessMode: ConnectorAccessMode
  /** Workspace mode: the credential the connector syncs as from now on. */
  credentialId?: string | null
  source?: KnowledgeOperationSource
  resolveBillingAttribution?(workspaceId: string): Promise<BillingAttributionSnapshot>
}

/**
 * Moves a connector between access modes. Admin only: `members` lets the
 * connector crawl as every person enrolled in the option, and `admin` lets it
 * crawl as an administrator and mirror the source's own permissions — both are
 * decisions about whose data the workspace indexes.
 */
export const updateKnowledgeConnectorAccess = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.updateConnectorAccess,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Principal
    input: UpdateKnowledgeConnectorAccessInput
  }) => resolveActiveKnowledgeConnectorContext(input, principal),
  async execute({ principal, input, context, request }) {
    const requestId = generateRequestId()
    const owner = resourceScopeFields(resourceScopeFromOwner(context.knowledgeBase))
    const actingUserId = resolveKnowledgeAttributedUserId(principal, context)
    const connector = await getKnowledgeConnector(context.knowledgeBaseId, context.connectorId)
    if (!connector) throw new OrchestrationError('not_found', 'Connector not found')
    const connectorMeta = getConnectorMeta(connector.connectorType)
    if (!connectorMeta) {
      throw new OrchestrationError(
        'validation',
        `Unknown connector type: ${connector.connectorType}`
      )
    }

    if (
      context.knowledgeBase.isSearchIndex &&
      (!connectorMeta.search || input.accessMode === 'workspace')
    ) {
      throw new OrchestrationError(
        'validation',
        'Search sources must support per-person access or source permissions'
      )
    }
    const sourceConfig = connector.sourceConfig as Record<string, unknown>

    let target: ConnectorAccessTarget
    if (input.accessMode === 'members') {
      const credentialId =
        input.credentialId === undefined && connector.accessMode === 'members'
          ? connector.credentialId
          : (input.credentialId ?? null)
      if (credentialId && !connectorMeta.supportsSeparateContentCredential) {
        throw new OrchestrationError(
          'validation',
          `${connectorMeta.name} cannot separate content ingestion from member permissions`
        )
      }
      target = {
        accessMode: 'members',
        credentialId,
        binding: await resolveKnowledgeConnectorMembersBinding({
          ...owner,
          connectorMeta,
          actingUserId,
          sourceConfig,
        }),
      }
      if (credentialId) {
        await requireUsableCredential({
          credentialId,
          connectorMeta,
          sourceConfig,
          ...owner,
          actingUserId,
          requestId,
          accessMode: 'members',
        })
        const rejection = await validateConnectorSourceConfig({
          connector: { ...connector, accessMode: 'members', credentialId },
          sourceConfig,
          ...owner,
          actingUserId,
          requestId,
        })
        if (rejection) throw new OrchestrationError(rejection.errorCode, rejection.message)
      }
    } else {
      if (mirrorsSourceAcls(input.accessMode)) {
        await assertConnectorMirrorsSourceAcls(
          connectorMeta,
          sourceConfig,
          resourceScopeFromOwner(owner)
        )
      }
      target = {
        accessMode: input.accessMode,
        credentialId: await requireUsableCredential({
          credentialId: input.credentialId,
          connectorMeta,
          sourceConfig,
          ...owner,
          actingUserId,
          requestId,
          accessMode: input.accessMode,
        }),
      }
      const rejection = await validateConnectorSourceConfig({
        connector: {
          ...connector,
          accessMode: target.accessMode,
          credentialId: target.credentialId,
        },
        sourceConfig,
        ...owner,
        actingUserId,
        requestId,
      })
      if (rejection) throw new OrchestrationError(rejection.errorCode, rejection.message)
      if (input.accessMode === 'admin' && connectorMeta.requiresMemberIdentity) {
        await requireKnowledgeMemberAccessAvailable(owner)
        await provisionKnowledgeConnectorMembersBinding({
          ...owner,
          connectorMeta,
          userId: actingUserId,
        })
      }
    }

    const outcome = await performUpdateKnowledgeConnectorAccess({
      knowledgeBase: { id: context.knowledgeBaseId, name: context.knowledgeBase.name, ...owner },
      connectorId: context.connectorId,
      target,
      resolveBillingAttribution: () =>
        (owner.workspaceId ? input.resolveBillingAttribution?.(owner.workspaceId) : undefined) ??
        resolveKnowledgeBillingAttribution(principal, context),
      userId: actingUserId,
      source: input.source ?? 'ui',
      requestId,
      request,
    })
    requireSuccessfulOutcome(outcome, 'Knowledge connector access update failed')
    return { connector: outcome.connector, changed: outcome.changed, ...owner }
  },
  projectAudit: ({ input, context, result }) =>
    result.changed
      ? {
          action: AuditAction.CONNECTOR_UPDATED,
          resourceType: AuditResourceType.CONNECTOR,
          resourceId: result.connector.id,
          resourceName: result.connector.connectorType,
          description: `Switched connector access to ${input.accessMode} mode for knowledge base "${context.knowledgeBase.name}"`,
          metadata: {
            source: input.source,
            knowledgeBaseId: context.knowledgeBaseId,
            knowledgeBaseName: context.knowledgeBase.name,
            connectorType: result.connector.connectorType,
            updatedFields: ['accessMode'],
            accessMode: input.accessMode,
          },
        }
      : [],
})

/**
 * Workspace mode needs a credential the caller may use, of the connector's own
 * provider, and one that yields a token, since the connector syncs as it from
 * then on. API-key connectors keep their canonical encrypted key; the shared
 * source validation verifies it against the target mode before any mutation.
 */
async function requireUsableCredential(input: {
  credentialId: string | null | undefined
  connectorMeta: Pick<ConnectorMeta, 'name' | 'auth'>
  sourceConfig: Record<string, unknown>
  workspaceId?: string
  organizationId?: string
  actingUserId: string
  requestId: string
  accessMode: ConnectorAccessMode
}): Promise<string | null> {
  const { auth } = input.connectorMeta
  if (auth.mode !== 'oauth') {
    if (input.credentialId) {
      throw new OrchestrationError('validation', 'API-key connectors use their configured API key')
    }
    return null
  }
  if (!input.credentialId) {
    throw new OrchestrationError(
      'validation',
      'credentialId is required for a mode that syncs with one credential'
    )
  }
  const service =
    getServiceConfigByServiceId(auth.provider) ?? getServiceConfigByProviderId(auth.provider)
  if (!service) {
    throw new OrchestrationError(
      'validation',
      `${input.connectorMeta.name} has no OAuth service to validate the credential against`
    )
  }
  const token = await resolveConnectorCredentialAccessToken({
    credentialId: input.credentialId,
    ...resourceScopeFields(resourceScopeFromOwner(input)),
    actingUserId: input.actingUserId,
    requestId: input.requestId,
    service,
    auth,
    accessMode: input.accessMode,
    sourceConfig: input.sourceConfig,
  })
  if (!token) {
    throw new OrchestrationError(
      'validation',
      'Credential has no access token. Please reconnect your account.'
    )
  }
  return input.credentialId
}
