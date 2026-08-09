import {
  deleteKnowledgeConnectorContract,
  getKnowledgeConnectorContract,
  updateKnowledgeConnectorContract,
} from '@/lib/api/contracts/knowledge'
import { defineInternalJsonRoute, internalRateLimits } from '@/lib/api/server/routes'
import { decryptApiKey } from '@/lib/api-key/crypto'
import { resolveCredentialTokenIdentity } from '@/lib/credentials/access'
import {
  toInternalKnowledgeConnector,
  toInternalKnowledgeConnectorDetail,
} from '@/lib/knowledge/api/internal-route'
import {
  internalKnowledgeErrorPolicies,
  internalKnowledgeSessionOrExecutorAuth,
} from '@/lib/knowledge/api/route-policies'
import {
  deleteKnowledgeConnector,
  readKnowledgeConnector,
  updateKnowledgeConnector,
} from '@/lib/knowledge/application/connectors'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import type {
  KnowledgeConnectorRow,
  SourceConfigRejection,
} from '@/lib/knowledge/orchestration/connectors'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'
import { CONNECTOR_REGISTRY } from '@/connectors/registry.server'

function makeSourceConfigValidator(actingUserId: string, workspaceId: string, connectorId: string) {
  return async (
    connector: KnowledgeConnectorRow,
    sourceConfig: Record<string, unknown>
  ): Promise<SourceConfigRejection | null> => {
    const connectorConfig = CONNECTOR_REGISTRY[connector.connectorType]
    if (!connectorConfig) {
      return {
        message: `Unknown connector type: ${connector.connectorType}`,
        errorCode: 'validation',
      }
    }

    let accessToken: string | null = null
    if (connectorConfig.auth.mode === 'apiKey') {
      if (!connector.encryptedApiKey) {
        return {
          message: 'API key not found. Please reconfigure the connector.',
          errorCode: 'validation',
        }
      }
      accessToken = (await decryptApiKey(connector.encryptedApiKey)).decrypted
    } else {
      if (!connector.credentialId) {
        return {
          message: 'OAuth credential not found. Please reconfigure the connector.',
          errorCode: 'validation',
        }
      }
      const identity = await resolveCredentialTokenIdentity(connector.credentialId, workspaceId)
      if (!identity) {
        return {
          message: 'Credential is no longer usable in this workspace. Please reconnect it.',
          errorCode: 'validation',
        }
      }
      accessToken = await refreshAccessTokenIfNeeded(
        connector.credentialId,
        identity.kind === 'oauth' ? identity.userId : actingUserId,
        `patch-${connectorId}`
      )
    }

    if (!accessToken) {
      return {
        message: 'Failed to refresh access token. Please reconnect your account.',
        errorCode: 'unauthorized',
      }
    }

    const validation = await connectorConfig.validateConfig(accessToken, sourceConfig)
    return validation.valid
      ? null
      : { message: validation.error || 'Invalid source configuration', errorCode: 'validation' }
  }
}

export const GET = defineInternalJsonRoute({
  contract: getKnowledgeConnectorContract,
  auth: internalKnowledgeSessionOrExecutorAuth,
  operation: knowledgeOperations.readConnector,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing internal connector-read behavior',
  }),
  errorPolicy: internalKnowledgeErrorPolicies.connectors,
  mapInput: ({ params }) => ({
    knowledgeBaseId: params.id,
    connectorId: params.connectorId,
  }),
  useCase: readKnowledgeConnector,
  present: ({ connector }) => ({
    success: true as const,
    data: toInternalKnowledgeConnectorDetail(connector),
  }),
})

export const PATCH = defineInternalJsonRoute({
  contract: updateKnowledgeConnectorContract,
  auth: internalKnowledgeSessionOrExecutorAuth,
  operation: knowledgeOperations.updateConnector,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing internal connector-update behavior',
  }),
  errorPolicy: internalKnowledgeErrorPolicies.connectors,
  mapInput: ({ params, body }) => ({
    connectorId: params.connectorId,
    knowledgeBaseId: params.id,
    updates: body,
    createSourceConfigValidator: (workspaceId: string, actingUserId: string) =>
      makeSourceConfigValidator(actingUserId, workspaceId, params.connectorId),
    source: 'ui' as const,
  }),
  useCase: updateKnowledgeConnector,
  present: ({ connector }) => ({
    success: true as const,
    data: toInternalKnowledgeConnector(connector),
  }),
})

export const DELETE = defineInternalJsonRoute({
  contract: deleteKnowledgeConnectorContract,
  auth: internalKnowledgeSessionOrExecutorAuth,
  operation: knowledgeOperations.deleteConnector,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing internal connector-delete behavior',
  }),
  errorPolicy: internalKnowledgeErrorPolicies.connectors,
  mapInput: ({ params, query }) => ({
    connectorId: params.connectorId,
    knowledgeBaseId: params.id,
    deleteDocuments: query.deleteDocuments,
    source: 'ui' as const,
  }),
  useCase: deleteKnowledgeConnector,
  present: () => ({ success: true as const }),
})
