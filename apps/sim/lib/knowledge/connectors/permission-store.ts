import { db } from '@sim/db'
import {
  knowledgeConnectorPermissionGrant,
  knowledgeConnectorPermissionSnapshot,
} from '@sim/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbTransaction } from '@/lib/db/types'

export type ConnectorPermissionSnapshot = typeof knowledgeConnectorPermissionSnapshot.$inferSelect

/** A complete replacement. Metadata can be read without loading the private payload or subject grants. */
export interface ConnectorPermissionData {
  metadata: Record<string, unknown>
  payload: Record<string, unknown>
  groups: readonly { groupKey: string; subjects: readonly string[] }[]
}

/** The application has authorized this canonical source and verified the reader's subject. */
export async function hasConnectorPermissionGrant(
  connectorId: string,
  groupKey: string,
  subjectToken: string
): Promise<boolean> {
  const table = knowledgeConnectorPermissionGrant
  const [grant] = await db
    .select({ connectorId: table.connectorId })
    .from(table)
    .where(
      and(
        eq(table.connectorId, connectorId),
        eq(table.groupKey, groupKey),
        eq(table.subjectToken, subjectToken)
      )
    )
    .limit(1)
  return Boolean(grant)
}

/** The connectors among `connectorIds` that grant the reader's subject at least one collection. */
export async function connectorsGrantingSubject(
  connectorIds: readonly string[],
  subjectToken: string
): Promise<Set<string>> {
  const table = knowledgeConnectorPermissionGrant
  const granted = new Set<string>()
  for (let offset = 0; offset < connectorIds.length; offset += 1000) {
    const rows = await db
      .selectDistinct({ connectorId: table.connectorId })
      .from(table)
      .where(
        and(
          eq(table.subjectToken, subjectToken),
          inArray(table.connectorId, connectorIds.slice(offset, offset + 1000))
        )
      )
    for (const row of rows) granted.add(row.connectorId)
  }
  return granted
}

/** Returns grants only for the bounded, canonical collections requested by the authorized caller. */
export async function readConnectorPermissionGrants(
  connectorId: string,
  expectedRevision: number,
  groupKeys: readonly string[],
  subjectToken: string
): Promise<Set<string>> {
  const table = knowledgeConnectorPermissionGrant
  const snapshot = knowledgeConnectorPermissionSnapshot
  const keys = new Set<string>()
  for (let offset = 0; offset < groupKeys.length; offset += 1000) {
    const rows = await db
      .select({ groupKey: table.groupKey })
      .from(table)
      .innerJoin(snapshot, eq(snapshot.connectorId, table.connectorId))
      .where(
        and(
          eq(table.connectorId, connectorId),
          eq(snapshot.revision, expectedRevision),
          eq(table.subjectToken, subjectToken),
          inArray(table.groupKey, groupKeys.slice(offset, offset + 1000))
        )
      )
    for (const row of rows) keys.add(row.groupKey)
  }
  return keys
}

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
  input: ConnectorPermissionData & { expectedRevision: number }
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
    let batch: Array<typeof knowledgeConnectorPermissionGrant.$inferInsert> = []
    for (const group of input.groups) {
      for (const subjectToken of group.subjects) {
        batch.push({ connectorId, groupKey: group.groupKey, subjectToken })
        if (batch.length === 1000) {
          await tx.insert(knowledgeConnectorPermissionGrant).values(batch)
          batch = []
        }
      }
    }
    if (batch.length) await tx.insert(knowledgeConnectorPermissionGrant).values(batch)
  } catch {
    /** Query exceptions may contain bind parameters from the private payload. */
    throw new OrchestrationError(
      'internal',
      'Could not save permissions. The previous configuration was preserved.'
    )
  }
  return values.revision
}
