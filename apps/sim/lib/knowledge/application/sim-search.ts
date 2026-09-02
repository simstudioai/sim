import { resolvePrincipalSubjectUserId } from '@sim/auth/principal'
import { db } from '@sim/db'
import { knowledgeBase, knowledgeConnector } from '@sim/db/schema'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { coalesceLocally } from '@/lib/concurrency/singleflight'
import {
  InsufficientWorkspacePermissionsError,
  requireCurrentHumanRole,
} from '@/lib/core/application/workspace-authorization'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { requireKnowledgeMemberAccessAvailable } from '@/lib/knowledge/access/availability'
import { defineAuthorizedKnowledgeUseCase } from '@/lib/knowledge/application/authorized-knowledge-use-case'
import { startKnowledgeConnectorMemberEnrollment } from '@/lib/knowledge/application/connector-access'
import {
  createKnowledgeConnector,
  deleteKnowledgeConnector,
} from '@/lib/knowledge/application/connectors'
import {
  type KnowledgeWorkspaceContext,
  resolveKnowledgeWorkspaceContext,
} from '@/lib/knowledge/application/contexts'
import {
  createKnowledgeBase,
  deleteKnowledgeBaseOperation,
} from '@/lib/knowledge/application/knowledge-bases'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import {
  canConnectPersonally,
  missingSetupFields,
  SIM_SEARCH_KNOWLEDGE_BASE_NAME,
} from '@/lib/sim-search/connectors'
import { CONNECTOR_META_REGISTRY } from '@/connectors/registry'

const SIM_SEARCH_KNOWLEDGE_BASE_DESCRIPTION =
  'What each person can open in the sources they connected, searched as them.'
/** Between runs the change feeds keep deletions and unshares fresh; the hourly run fills the rest. */
const SIM_SEARCH_SYNC_INTERVAL_MINUTES = 60

export interface ConnectSimSearchConnectorInput {
  workspaceId: string
  /** `CONNECTOR_META_REGISTRY` key of the source to connect. */
  connectorType: string
  /** The source's setup fields (a site, a space); read only when this connect creates the connector. */
  sourceConfig?: Record<string, string>
}

export interface ConnectSimSearchConnectorResult {
  knowledgeBaseId: string
  connectorId: string
  /** The enrollment link that connects the caller's own account. */
  url: string
}

async function findSimSearchConnector(workspaceId: string, connectorType: string) {
  const [row] = await db
    .select({ knowledgeBaseId: knowledgeBase.id, connectorId: knowledgeConnector.id })
    .from(knowledgeConnector)
    .innerJoin(knowledgeBase, eq(knowledgeBase.id, knowledgeConnector.knowledgeBaseId))
    .where(
      and(
        eq(knowledgeBase.workspaceId, workspaceId),
        eq(knowledgeBase.name, SIM_SEARCH_KNOWLEDGE_BASE_NAME),
        isNull(knowledgeBase.deletedAt),
        eq(knowledgeConnector.connectorType, connectorType),
        eq(knowledgeConnector.accessMode, 'members'),
        isNull(knowledgeConnector.archivedAt),
        isNull(knowledgeConnector.deletedAt)
      )
    )
    .orderBy(asc(knowledgeConnector.createdAt))
    .limit(1)
  return row ?? null
}

async function findSimSearchKnowledgeBase(workspaceId: string) {
  const [row] = await db
    .select({ id: knowledgeBase.id })
    .from(knowledgeBase)
    .where(
      and(
        eq(knowledgeBase.workspaceId, workspaceId),
        eq(knowledgeBase.name, SIM_SEARCH_KNOWLEDGE_BASE_NAME),
        isNull(knowledgeBase.deletedAt)
      )
    )
    .orderBy(asc(knowledgeBase.createdAt))
    .limit(1)
  return row ?? null
}

/**
 * The first connect of a source turns it on for the whole workspace, which is
 * an admin decision the same way a members-mode connector is. Refused with
 * the way forward rather than the nested operations' generic role error, so a
 * reader learns whom to ask and for what.
 */
async function requireSimSearchSetupAdmin(
  userId: string,
  context: KnowledgeWorkspaceContext,
  sourceName: string
): Promise<void> {
  try {
    await requireCurrentHumanRole(userId, context, 'admin')
  } catch (error) {
    if (!(error instanceof InsufficientWorkspacePermissionsError)) throw error
    throw new OrchestrationError(
      'forbidden',
      `${sourceName} is not connected in this workspace yet. Ask a workspace admin to connect ${sourceName} first; after that everyone connects their own account.`
    )
  }
}

/**
 * One click on a Sim Search source: the workspace's Sim Search knowledge base
 * and a per-member connector for that source exist after this, and the caller
 * gets the link that connects their own account. The first connect of a
 * source creates both, which takes a workspace admin and the source's setup
 * fields when it has any; every connect after that only enrolls. The OAuth
 * completion queues the member run, so indexing starts on its own.
 *
 * The creating branch shares one creation per workspace base and per source
 * within the process and re-checks before creating: nothing in the schema
 * keeps two concurrent first connects from each creating a Sim Search base
 * and a connector of the same source. The nested use cases query the pool,
 * so this cannot hold a transaction across them.
 */
export const connectSimSearchConnector = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.simSearchConnect,
  resolveContext: ({ input }: { input: ConnectSimSearchConnectorInput }) =>
    resolveKnowledgeWorkspaceContext(input),
  async execute({ principal, input, context, request }): Promise<ConnectSimSearchConnectorResult> {
    const meta = CONNECTOR_META_REGISTRY[input.connectorType]
    if (!meta || !canConnectPersonally(meta)) {
      throw new OrchestrationError(
        'validation',
        'This source cannot be connected per person; a workspace admin sets it up from a knowledge base'
      )
    }
    const workspaceId = context.workspaceId
    let target = await findSimSearchConnector(workspaceId, input.connectorType)
    if (!target) {
      const userId = resolvePrincipalSubjectUserId(principal)
      if (!userId) throw new OrchestrationError('forbidden', 'Sign in to connect your account')
      const sourceConfig = input.sourceConfig ?? {}
      const missing = missingSetupFields(meta, sourceConfig)
      if (missing.length > 0) {
        throw new OrchestrationError(
          'validation',
          `${meta.name} needs ${missing.map((field) => field.title).join(' and ')} to connect`
        )
      }
      /**
       * Judged before anything is created: the connector creation below checks
       * the same availability, but only after the knowledge base exists.
       */
      await Promise.all([
        requireKnowledgeMemberAccessAvailable({ workspaceId }),
        requireSimSearchSetupAdmin(userId, context, meta.name),
      ])
      /**
       * Concurrent first connects in this process share one creation per
       * workspace base and per source, and each re-checks before creating.
       * Two instances can still race in the same instant: every lookup here
       * orders by the oldest row, so after creating, each re-reads and the one
       * that finds an older row than its own deletes what it just made and
       * converges on the older one. Nothing stray outlives the request.
       */
      const knowledgeBaseId = await coalesceLocally(`sim-search:base:${workspaceId}`, async () => {
        const existing = await findSimSearchKnowledgeBase(workspaceId)
        if (existing) return existing.id
        const created = (
          await createKnowledgeBase.execute({
            principal,
            input: {
              workspaceId,
              name: SIM_SEARCH_KNOWLEDGE_BASE_NAME,
              description: SIM_SEARCH_KNOWLEDGE_BASE_DESCRIPTION,
              source: 'ui',
            },
            request,
          })
        ).knowledgeBase.id
        const oldest = (await findSimSearchKnowledgeBase(workspaceId))?.id ?? created
        if (oldest !== created) {
          await deleteKnowledgeBaseOperation.execute({
            principal,
            input: { knowledgeBaseId: created, assertedWorkspaceId: workspaceId, source: 'ui' },
            request,
          })
        }
        return oldest
      })
      target = await coalesceLocally(
        `sim-search:connect:${workspaceId}:${input.connectorType}`,
        async () => {
          const existing = await findSimSearchConnector(workspaceId, input.connectorType)
          if (existing) return existing
          const created = await createKnowledgeConnector.execute({
            principal,
            input: {
              knowledgeBaseId,
              assertedWorkspaceId: workspaceId,
              connectorType: input.connectorType,
              sourceConfig,
              syncIntervalMinutes: SIM_SEARCH_SYNC_INTERVAL_MINUTES,
              accessMode: 'members',
              source: 'ui',
            },
            request,
          })
          const oldest = await findSimSearchConnector(workspaceId, input.connectorType)
          if (oldest && oldest.connectorId !== created.connector.id) {
            await deleteKnowledgeConnector.execute({
              principal,
              input: {
                connectorId: created.connector.id,
                assertedWorkspaceId: workspaceId,
                deleteDocuments: true,
                source: 'ui',
              },
              request,
            })
            return oldest
          }
          return { knowledgeBaseId, connectorId: created.connector.id }
        }
      )
    }
    const { url } = await startKnowledgeConnectorMemberEnrollment.execute({
      principal,
      input: {
        knowledgeBaseId: target.knowledgeBaseId,
        connectorId: target.connectorId,
        assertedWorkspaceId: workspaceId,
      },
      request,
    })
    return { ...target, url }
  },
})
