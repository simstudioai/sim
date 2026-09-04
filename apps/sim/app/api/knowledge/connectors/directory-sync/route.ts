import { db } from '@sim/db'
import { knowledgeBase, knowledgeConnector } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { and, eq, isNull } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { verifyCronAuth } from '@/lib/auth/internal'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { resolveCredentialTokenIdentity } from '@/lib/credentials/access'
import { resolveConnectorAccessToken } from '@/lib/knowledge/connectors/access-token'
import { refreshMirroredDirectory } from '@/lib/knowledge/connectors/external-group-sync'
import { CONNECTOR_REGISTRY } from '@/connectors/registry.server'

export const dynamic = 'force-dynamic'

const logger = createLogger('ConnectorDirectorySyncSchedulerAPI')

/** Directories refreshed per tick, and how many at once. */
const MAX_DIRECTORIES_PER_TICK = 200
const REFRESH_CONCURRENCY = 4

/**
 * Refreshes the external directories that admin-mode connectors mirror.
 *
 * Group membership decides who can read an already-indexed document, so it has
 * to move on its own clock: someone leaving a group should lose access in
 * minutes, not on whatever schedule the corpus happens to be re-crawled on. The
 * admin crawl refreshes the directory too — so a crawl can never publish grants
 * against membership nobody has read — but that is a floor, not the cadence.
 *
 * Every eligible connector is offered each tick; `syncExternalDirectoryGroups`
 * decides whether its directory is actually due. Connectors sharing a directory
 * therefore cost one refresh between them: the first brings it up to date and
 * the rest skip. Two ticks overlapping on one directory would both enumerate
 * and write the same rows — wasteful, never wrong, and not worth a lease to
 * prevent, since every write here is idempotent.
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()
  logger.info(`[${requestId}] Connector directory sync scheduler triggered`)

  const authError = verifyCronAuth(request, 'Connector directory sync scheduler')
  if (authError) return authError

  const connectors = await db
    .select({
      id: knowledgeConnector.id,
      connectorType: knowledgeConnector.connectorType,
      credentialId: knowledgeConnector.credentialId,
      encryptedApiKey: knowledgeConnector.encryptedApiKey,
      sourceConfig: knowledgeConnector.sourceConfig,
      workspaceId: knowledgeBase.workspaceId,
      knowledgeBaseOwnerId: knowledgeBase.userId,
    })
    .from(knowledgeConnector)
    .innerJoin(knowledgeBase, eq(knowledgeConnector.knowledgeBaseId, knowledgeBase.id))
    .where(
      and(
        eq(knowledgeConnector.accessMode, 'admin'),
        isNull(knowledgeConnector.archivedAt),
        isNull(knowledgeConnector.deletedAt),
        isNull(knowledgeBase.deletedAt)
      )
    )
    .limit(MAX_DIRECTORIES_PER_TICK)

  const outcomes = await mapWithConcurrency(connectors, REFRESH_CONCURRENCY, async (connector) => {
    /**
     * Every failure is contained here. One workspace whose credential lapsed
     * must not stop the tick refreshing every other workspace's directory.
     */
    try {
      if (!connector.workspaceId) return 'skipped'
      const connectorConfig = CONNECTOR_REGISTRY[connector.connectorType]
      if (!connectorConfig?.openDirectory) return 'skipped'

      /**
       * The credential's own account owner, not the knowledge base owner —
       * token reads are scoped to `account.userId`, and a service account
       * ignores the argument entirely.
       */
      let credentialUserId = connector.knowledgeBaseOwnerId
      if (connector.credentialId) {
        const identity = await resolveCredentialTokenIdentity(
          connector.credentialId,
          connector.workspaceId
        )
        if (!identity) return 'unusable'
        if (identity.kind === 'oauth') credentialUserId = identity.userId
      }

      const sourceConfig = connector.sourceConfig as Record<string, unknown>
      const token = await resolveConnectorAccessToken({
        auth: connectorConfig.auth,
        connector,
        userId: credentialUserId,
        requestId,
        sourceConfig,
      })
      if (!token) return 'unusable'

      await refreshMirroredDirectory({
        workspaceId: connector.workspaceId,
        connectorConfig,
        sourceConfig,
        syncContext: {},
        accessToken: token.accessToken,
      })
      return 'refreshed'
    } catch (error) {
      logger.error(`[${requestId}] Directory refresh failed for a connector`, {
        connectorId: connector.id,
        error: getErrorMessage(error),
      })
      return 'failed'
    }
  })

  const summary = {
    considered: connectors.length,
    refreshed: outcomes.filter((outcome) => outcome === 'refreshed').length,
    skipped: outcomes.filter((outcome) => outcome === 'skipped').length,
    unusable: outcomes.filter((outcome) => outcome === 'unusable').length,
    failed: outcomes.filter((outcome) => outcome === 'failed').length,
  }
  logger.info(`[${requestId}] Connector directory sync scheduler finished`, summary)
  return Response.json({ success: true, ...summary })
})
