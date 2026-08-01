import { db } from '@sim/db'
import { knowledgeConnectorSyncLog } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { desc, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import {
  deleteKnowledgeConnectorContract,
  updateKnowledgeConnectorContract,
} from '@/lib/api/contracts/knowledge'
import { parseRequest } from '@/lib/api/server'
import { decryptApiKey } from '@/lib/api-key/crypto'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import {
  messageForOrchestrationError,
  statusForOrchestrationError,
} from '@/lib/core/orchestration/types'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { resolveCredentialTokenIdentity } from '@/lib/credentials/access'
import {
  getKnowledgeConnector,
  type KnowledgeConnectorRow,
  performDeleteKnowledgeConnector,
  performUpdateKnowledgeConnector,
} from '@/lib/knowledge/orchestration'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'
import { checkKnowledgeBaseAccess, checkKnowledgeBaseWriteAccess } from '@/app/api/knowledge/utils'
import { CONNECTOR_REGISTRY } from '@/connectors/registry.server'

const logger = createLogger('KnowledgeConnectorByIdAPI')

type RouteParams = { params: Promise<{ id: string; connectorId: string }> }

/**
 * GET /api/knowledge/[id]/connectors/[connectorId] - Get connector details with recent sync logs
 */
export const GET = withRouteHandler(async (request: NextRequest, { params }: RouteParams) => {
  const requestId = generateRequestId()
  const { id: knowledgeBaseId, connectorId } = await params

  try {
    const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accessCheck = await checkKnowledgeBaseAccess(knowledgeBaseId, auth.userId)
    if (!accessCheck.hasAccess) {
      const status = 'notFound' in accessCheck && accessCheck.notFound ? 404 : 401
      return NextResponse.json({ error: status === 404 ? 'Not found' : 'Unauthorized' }, { status })
    }

    const connector = await getKnowledgeConnector(knowledgeBaseId, connectorId)
    if (!connector) {
      return NextResponse.json({ error: 'Connector not found' }, { status: 404 })
    }

    const syncLogs = await db
      .select()
      .from(knowledgeConnectorSyncLog)
      .where(eq(knowledgeConnectorSyncLog.connectorId, connectorId))
      .orderBy(desc(knowledgeConnectorSyncLog.startedAt))
      .limit(10)

    const { encryptedApiKey: _, ...connectorData } = connector
    return NextResponse.json({
      success: true,
      data: {
        ...connectorData,
        syncLogs,
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching connector`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})

/**
 * Validates a replacement `sourceConfig` against the live source, resolving the
 * connector's own token first. Returns a rejection message, or `null` to accept.
 *
 * Stays with the route rather than moving into orchestration because resolving
 * the token needs the requesting identity: workspace credentials are shared and
 * token reads are scoped to `account.userId`, so the credential's own account
 * owner is used — not the knowledge base owner, and not the acting user when a
 * service account mints its own token.
 */
function makeSourceConfigValidator(
  actingUserId: string,
  workspaceId: string | null,
  connectorId: string
) {
  return async (
    connector: KnowledgeConnectorRow,
    sourceConfig: Record<string, unknown>
  ): Promise<string | null> => {
    const connectorConfig = CONNECTOR_REGISTRY[connector.connectorType]
    if (!connectorConfig) {
      return `Unknown connector type: ${connector.connectorType}`
    }

    let accessToken: string | null = null
    if (connectorConfig.auth.mode === 'apiKey') {
      if (!connector.encryptedApiKey) {
        return 'API key not found. Please reconfigure the connector.'
      }
      accessToken = (await decryptApiKey(connector.encryptedApiKey)).decrypted
    } else {
      if (!connector.credentialId) {
        return 'OAuth credential not found. Please reconfigure the connector.'
      }
      if (!workspaceId) {
        return 'Knowledge base is missing workspace context'
      }
      const identity = await resolveCredentialTokenIdentity(connector.credentialId, workspaceId)
      if (!identity) {
        return 'Credential is no longer usable in this workspace. Please reconnect it.'
      }
      accessToken = await refreshAccessTokenIfNeeded(
        connector.credentialId,
        // Service accounts mint their own token and ignore the acting user.
        identity.kind === 'oauth' ? identity.userId : actingUserId,
        `patch-${connectorId}`
      )
    }

    if (!accessToken) {
      return 'Failed to refresh access token. Please reconnect your account.'
    }

    const validation = await connectorConfig.validateConfig(accessToken, sourceConfig)
    return validation.valid ? null : validation.error || 'Invalid source configuration'
  }
}

/**
 * PATCH /api/knowledge/[id]/connectors/[connectorId] - Update a connector
 */
export const PATCH = withRouteHandler(async (request: NextRequest, context: RouteParams) => {
  const requestId = generateRequestId()
  const { id: knowledgeBaseId, connectorId } = await context.params

  const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const writeCheck = await checkKnowledgeBaseWriteAccess(knowledgeBaseId, auth.userId)
  if (!writeCheck.hasAccess) {
    const status = 'notFound' in writeCheck && writeCheck.notFound ? 404 : 401
    return NextResponse.json({ error: status === 404 ? 'Not found' : 'Unauthorized' }, { status })
  }

  const parsed = await parseRequest(updateKnowledgeConnectorContract, request, context)
  if (!parsed.success) return parsed.response

  const outcome = await performUpdateKnowledgeConnector({
    knowledgeBase: {
      id: knowledgeBaseId,
      name: writeCheck.knowledgeBase.name,
      workspaceId: writeCheck.knowledgeBase.workspaceId ?? null,
    },
    connectorId,
    updates: parsed.data.body,
    validateSourceConfig: makeSourceConfigValidator(
      auth.userId,
      writeCheck.knowledgeBase.workspaceId ?? null,
      connectorId
    ),
    userId: auth.userId,
    actorName: auth.userName,
    actorEmail: auth.userEmail,
    source: 'ui',
    requestId,
    request,
  })
  if (!outcome.success) {
    return NextResponse.json(
      { error: messageForOrchestrationError(outcome, 'Internal server error') },
      { status: statusForOrchestrationError(outcome.errorCode) }
    )
  }

  return NextResponse.json({ success: true, data: outcome.connector })
})

/**
 * DELETE /api/knowledge/[id]/connectors/[connectorId] - Hard-delete a connector
 */
export const DELETE = withRouteHandler(async (request: NextRequest, context: RouteParams) => {
  const requestId = generateRequestId()
  const { id: knowledgeBaseId, connectorId } = await context.params

  const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const writeCheck = await checkKnowledgeBaseWriteAccess(knowledgeBaseId, auth.userId)
  if (!writeCheck.hasAccess) {
    const status = 'notFound' in writeCheck && writeCheck.notFound ? 404 : 401
    return NextResponse.json({ error: status === 404 ? 'Not found' : 'Unauthorized' }, { status })
  }

  const parsed = await parseRequest(deleteKnowledgeConnectorContract, request, context)
  if (!parsed.success) return parsed.response

  const outcome = await performDeleteKnowledgeConnector({
    knowledgeBase: {
      id: knowledgeBaseId,
      name: writeCheck.knowledgeBase.name,
      workspaceId: writeCheck.knowledgeBase.workspaceId ?? null,
    },
    connectorId,
    deleteDocuments: parsed.data.query.deleteDocuments,
    userId: auth.userId,
    actorName: auth.userName,
    actorEmail: auth.userEmail,
    source: 'ui',
    requestId,
    request,
  })
  if (!outcome.success) {
    return NextResponse.json(
      { error: messageForOrchestrationError(outcome, 'Internal server error') },
      { status: statusForOrchestrationError(outcome.errorCode) }
    )
  }

  return NextResponse.json({ success: true })
})
