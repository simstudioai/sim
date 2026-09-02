import { db } from '@sim/db'
import { knowledgeBase, knowledgeConnector } from '@sim/db/schema'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { defineAuthorizedKnowledgeUseCase } from '@/lib/knowledge/application/authorized-knowledge-use-case'
import { startKnowledgeConnectorMemberEnrollment } from '@/lib/knowledge/application/connector-access'
import { createKnowledgeConnector } from '@/lib/knowledge/application/connectors'
import { resolveKnowledgeWorkspaceContext } from '@/lib/knowledge/application/contexts'
import { createKnowledgeBase } from '@/lib/knowledge/application/knowledge-bases'
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
 * One click on a Sim Search source: the workspace's Sim Search knowledge base
 * and a per-member connector for that source exist after this (the first
 * connect creates them, which the connector operation reserves for an admin,
 * and supplies the source's setup fields when it has any), and the caller
 * gets the link that connects their own account. The OAuth completion queues
 * their member run, so indexing starts on its own.
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
      const sourceConfig = input.sourceConfig ?? {}
      const missing = missingSetupFields(meta, sourceConfig)
      if (missing.length > 0) {
        throw new OrchestrationError(
          'validation',
          `${meta.name} needs ${missing.map((field) => field.title).join(' and ')} to connect`
        )
      }
      const knowledgeBaseId =
        (await findSimSearchKnowledgeBase(workspaceId))?.id ??
        (
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
      target = { knowledgeBaseId, connectorId: created.connector.id }
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
