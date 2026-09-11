import { db } from '@sim/db'
import {
  knowledgeConnectorPermissionGrant,
  knowledgeConnectorPermissionSnapshot,
} from '@sim/db/schema'
import { eq, inArray } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbTransaction } from '@/lib/db/types'

export type ConnectorPermissionSnapshot = typeof knowledgeConnectorPermissionSnapshot.$inferSelect

/** Call only after authorizing the connector; this materializes its private normalized input. */
export async function loadConnectorPermissionSnapshot(connectorId: string) {
  const [row] = await db
    .select()
    .from(knowledgeConnectorPermissionSnapshot)
    .where(eq(knowledgeConnectorPermissionSnapshot.connectorId, connectorId))
    .limit(1)
  return row ?? null
}

/** Metadata and worker reads leave the potentially large payload in PostgreSQL. */
export async function readConnectorPermissionMetadata(connectorIds: readonly string[]) {
  const table = knowledgeConnectorPermissionSnapshot
  const result: Array<Pick<ConnectorPermissionSnapshot, 'connectorId' | 'revision' | 'metadata'>> =
    []
  for (let offset = 0; offset < connectorIds.length; offset += 1000) {
    result.push(
      ...(await db
        .select({
          connectorId: table.connectorId,
          revision: table.revision,
          metadata: table.metadata,
        })
        .from(table)
        .where(inArray(table.connectorId, connectorIds.slice(offset, offset + 1000))))
    )
  }
  return result
}

/** The caller holds the connector row lock and commits configuration, credentials and grants together. */
export async function writeConnectorPermissions(
  tx: DbTransaction,
  connectorId: string,
  input: {
    expectedRevision: number
    metadata: Record<string, unknown>
    payload: Record<string, unknown>
    groups: readonly { groupKey: string; subjects: readonly string[] }[]
  }
) {
  const table = knowledgeConnectorPermissionSnapshot
  const [current] = await tx
    .select({ revision: table.revision })
    .from(table)
    .where(eq(table.connectorId, connectorId))
    .limit(1)
  if ((current?.revision ?? 0) !== input.expectedRevision) {
    throw new OrchestrationError(
      'conflict',
      'Permissions changed. Reload the connection before saving.'
    )
  }
  const values = {
    revision: input.expectedRevision + 1,
    metadata: input.metadata,
    payload: input.payload,
  }
  try {
    await tx
      .insert(table)
      .values({ connectorId, ...values })
      .onConflictDoUpdate({ target: table.connectorId, set: values })
    await tx
      .delete(knowledgeConnectorPermissionGrant)
      .where(eq(knowledgeConnectorPermissionGrant.connectorId, connectorId))
    for (const group of input.groups) {
      for (let offset = 0; offset < group.subjects.length; offset += 1000) {
        await tx
          .insert(knowledgeConnectorPermissionGrant)
          .values(
            group.subjects
              .slice(offset, offset + 1000)
              .map((subjectToken) => ({ connectorId, groupKey: group.groupKey, subjectToken }))
          )
      }
    }
  } catch {
    /** Query exceptions may contain bind parameters from the private payload. */
    throw new OrchestrationError(
      'internal',
      'Could not save permissions. The previous configuration was preserved.'
    )
  }
}
