import { AuditAction, AuditResourceType } from '@sim/audit'
import { type Principal, resolvePrincipalSubjectUserId } from '@sim/auth/principal'
import type { BillingAttributionSnapshot } from '@/lib/billing/core/billing-attribution'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { generateRequestId } from '@/lib/core/utils/request'
import { isKnowledgeMemberAccessAvailable } from '@/lib/knowledge/access/availability'
import { defineAuthorizedKnowledgeUseCase } from '@/lib/knowledge/application/authorized-knowledge-use-case'
import {
  resolveKnowledgeAttributedUserId,
  resolveKnowledgeBillingAttribution,
} from '@/lib/knowledge/application/billing'
import {
  requireConnectorWorkspaceId,
  requireSuccessfulOutcome,
  resolveConnectorCredentialAccessToken,
} from '@/lib/knowledge/application/connectors'
import { resolveActiveKnowledgeConnectorContext } from '@/lib/knowledge/application/contexts'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { createViewerConnectorEnrollmentLink } from '@/lib/knowledge/connectors/member-provisioning'
import {
  performUpdateKnowledgeConnectorAccess,
  resolveKnowledgeConnectorMembersBinding,
} from '@/lib/knowledge/orchestration/connector-access'
import { getKnowledgeConnector } from '@/lib/knowledge/orchestration/connectors'
import type { KnowledgeOperationSource } from '@/lib/knowledge/orchestration/shared'
import { getServiceConfigByProviderId, getServiceConfigByServiceId } from '@/lib/oauth'
import { getConnectorMeta } from '@/connectors/registry'
import type { ConnectorMeta } from '@/connectors/types'

export interface StartKnowledgeConnectorMemberEnrollmentInput {
  knowledgeBaseId: string
  connectorId: string
  assertedWorkspaceId?: string
}

/**
 * Hands a workspace member the link that connects their own account to a
 * per-member connector, minted on demand so they never need the invitation
 * email. Only widens what the member themselves can see.
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
    const workspaceId = requireConnectorWorkspaceId(context)
    const userId = resolvePrincipalSubjectUserId(principal)
    if (!userId) throw new OrchestrationError('forbidden', 'Sign in to connect your account')
    const connector = await getKnowledgeConnector(context.knowledgeBaseId, context.connectorId)
    if (!connector) throw new OrchestrationError('not_found', 'Connector not found')
    if (connector.accessMode !== 'members' || !connector.credentialGroupId) {
      throw new OrchestrationError('validation', 'This connector does not sync per member')
    }
    if (!(await isKnowledgeMemberAccessAvailable({ workspaceId }))) {
      throw new OrchestrationError(
        'validation',
        'Per-member access is not available for this workspace'
      )
    }
    const url = await createViewerConnectorEnrollmentLink({
      userId,
      workspaceId,
      credentialGroupId: connector.credentialGroupId,
    })
    return { url }
  },
})

export interface UpdateKnowledgeConnectorAccessInput {
  knowledgeBaseId: string
  connectorId: string
  assertedWorkspaceId?: string
  accessMode: 'workspace' | 'members'
  credentialGroupId?: string
  credentialGroupOptionId?: string
  /** Workspace mode: the credential the connector syncs as from now on. */
  credentialId?: string
  source?: KnowledgeOperationSource
  resolveBillingAttribution?(workspaceId: string): Promise<BillingAttributionSnapshot>
}

/**
 * Moves a connector between workspace and members mode. Admin only: members
 * mode lets the connector crawl as every person enrolled in the option.
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
    const workspaceId = requireConnectorWorkspaceId(context)
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

    const target =
      input.accessMode === 'members'
        ? {
            accessMode: 'members' as const,
            binding: await resolveKnowledgeConnectorMembersBinding({
              workspaceId,
              connectorMeta,
              binding:
                input.credentialGroupId && input.credentialGroupOptionId
                  ? {
                      credentialGroupId: input.credentialGroupId,
                      credentialGroupOptionId: input.credentialGroupOptionId,
                    }
                  : null,
              actingUserId,
              sourceConfig: connector.sourceConfig as Record<string, unknown>,
            }),
          }
        : {
            accessMode: 'workspace' as const,
            credentialId: await requireUsableCredential({
              credentialId: input.credentialId,
              connectorMeta,
              workspaceId,
              actingUserId,
              requestId,
            }),
          }

    const outcome = await performUpdateKnowledgeConnectorAccess({
      knowledgeBase: { id: context.knowledgeBaseId, name: context.knowledgeBase.name, workspaceId },
      connectorId: context.connectorId,
      target,
      resolveBillingAttribution: () =>
        input.resolveBillingAttribution?.(workspaceId) ??
        resolveKnowledgeBillingAttribution(principal, context),
      userId: actingUserId,
      source: input.source ?? 'ui',
      requestId,
      request,
    })
    requireSuccessfulOutcome(outcome, 'Knowledge connector access update failed')
    return { connector: outcome.connector, changed: outcome.changed, workspaceId }
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
            ...(input.credentialGroupId ? { credentialGroupId: input.credentialGroupId } : {}),
            ...(input.credentialGroupOptionId
              ? { credentialGroupOptionId: input.credentialGroupOptionId }
              : {}),
          },
        }
      : [],
})

/**
 * Workspace mode needs a credential the caller may use, of the connector's own
 * provider, and one that yields a token, since the connector syncs as it from
 * then on with no call to the source to catch a mismatch. Only an OAuth
 * connector can change modes: an API-key connector has no account to sync per
 * member.
 */
async function requireUsableCredential(input: {
  credentialId: string | undefined
  connectorMeta: Pick<ConnectorMeta, 'name' | 'auth'>
  workspaceId: string
  actingUserId: string
  requestId: string
}): Promise<string> {
  const { auth } = input.connectorMeta
  if (auth.mode !== 'oauth') {
    throw new OrchestrationError('validation', 'Only OAuth connectors can change access mode')
  }
  if (!input.credentialId) {
    throw new OrchestrationError('validation', 'credentialId is required for workspace mode')
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
    workspaceId: input.workspaceId,
    actingUserId: input.actingUserId,
    requestId: input.requestId,
    service,
  })
  if (!token) {
    throw new OrchestrationError(
      'validation',
      'Credential has no access token. Please reconnect your account.'
    )
  }
  return input.credentialId
}
