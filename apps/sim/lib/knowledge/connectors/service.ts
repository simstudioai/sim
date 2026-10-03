import { db } from '@sim/db'
import { knowledgeConnector } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { connectorIsLive } from '@/lib/knowledge/connectors/sync-lock'

export interface ActiveKnowledgeConnectorReference {
  id: string
  knowledgeBaseId: string
  connectorType: string
  status: string
}

/** Resolves a connector's canonical active parent without trusting a caller-supplied KB ID. */
export async function getActiveKnowledgeConnectorReference(
  connectorId: string
): Promise<ActiveKnowledgeConnectorReference | null> {
  const [connector] = await db
    .select({
      id: knowledgeConnector.id,
      knowledgeBaseId: knowledgeConnector.knowledgeBaseId,
      connectorType: knowledgeConnector.connectorType,
      status: knowledgeConnector.status,
    })
    .from(knowledgeConnector)
    .where(and(eq(knowledgeConnector.id, connectorId), connectorIsLive()))
    .limit(1)

  return connector ?? null
}
