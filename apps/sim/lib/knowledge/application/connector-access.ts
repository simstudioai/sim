import { AuditAction, AuditResourceType } from '@sim/audit'
import { type Principal, resolvePrincipalSubjectUserId } from '@sim/auth/principal'
import type { BillingAttributionSnapshot } from '@/lib/billing/core/billing-attribution'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { generateRequestId } from '@/lib/core/utils/request'
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
import {
  performUpdateKnowledgeConnectorAccess,
  resolveKnowledgeConnectorMembersBinding,
} from '@/lib/knowledge/orchestration/connector-access'
import { getKnowledgeConnector } from '@/lib/knowledge/orchestration/connectors'
import type { KnowledgeOperationSource } from '@/lib/knowledge/orchestration/shared'
import { getConnectorMeta } from '@/connectors/registry'

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
              actingUserId: resolvePrincipalSubjectUserId(principal) ?? undefined,
              connectorMeta,
              binding: {
                credentialGroupId: requireBindingField(
                  input.credentialGroupId,
                  'credentialGroupId'
                ),
                credentialGroupOptionId: requireBindingField(
                  input.credentialGroupOptionId,
                  'credentialGroupOptionId'
                ),
              },
              sourceConfig: connector.sourceConfig as Record<string, unknown>,
            }),
          }
        : {
            accessMode: 'workspace' as const,
            credentialId: await requireUsableCredential({
              credentialId: input.credentialId,
              connectorAuthMode: connectorMeta.auth.mode,
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

function requireBindingField(value: string | undefined, field: string): string {
  if (!value) throw new OrchestrationError('validation', `${field} is required for members mode`)
  return value
}

/**
 * Workspace mode needs a credential the caller may use, and one that yields a
 * token, since the connector syncs as it from then on. An API-key connector
 * has no credential to name and keeps its stored key.
 */
async function requireUsableCredential(input: {
  credentialId: string | undefined
  connectorAuthMode: 'oauth' | 'apiKey'
  workspaceId: string
  actingUserId: string
  requestId: string
}): Promise<string> {
  if (input.connectorAuthMode !== 'oauth') {
    throw new OrchestrationError('validation', 'Only OAuth connectors can change access mode')
  }
  if (!input.credentialId) {
    throw new OrchestrationError('validation', 'credentialId is required for workspace mode')
  }
  const token = await resolveConnectorCredentialAccessToken({
    credentialId: input.credentialId,
    workspaceId: input.workspaceId,
    actingUserId: input.actingUserId,
    requestId: input.requestId,
  })
  if (!token) {
    throw new OrchestrationError(
      'validation',
      'Credential has no access token. Please reconnect your account.'
    )
  }
  return input.credentialId
}
