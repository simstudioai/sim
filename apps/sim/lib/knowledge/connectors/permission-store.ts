import { db } from '@sim/db'
import {
  knowledgeConnectorPermissionGrant,
  knowledgeConnectorPermissionImport,
  knowledgeConnectorPermissionImportGrant,
  knowledgeConnectorPermissionImportIdentity,
  knowledgeConnectorPermissionSnapshot,
} from '@sim/db/schema'
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import { unionAll } from 'drizzle-orm/pg-core'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbTransaction } from '@/lib/db/types'
import { enqueuePermissionImportCleanup } from '@/lib/knowledge/connectors/permission-import-cleanup'

export type ConnectorPermissionSnapshot = typeof knowledgeConnectorPermissionSnapshot.$inferSelect

/** A complete replacement. Metadata can be read without loading the private payload or subject grants. */
export interface ConnectorPermissionData {
  metadata: Record<string, unknown>
  payload: Record<string, unknown>
  groups: readonly { groupKey: string; subjects: readonly string[] }[]
}

/** Both formats expose the active snapshot only; staged and superseded imports never grant access. */
export function activeConnectorPermissionGrants() {
  const legacy = knowledgeConnectorPermissionGrant
  const snapshot = knowledgeConnectorPermissionSnapshot
  const imports = knowledgeConnectorPermissionImport
  const grants = knowledgeConnectorPermissionImportGrant
  const identities = knowledgeConnectorPermissionImportIdentity
  return unionAll(
    db
      .select({
        connectorId: legacy.connectorId,
        groupKey: legacy.groupKey,
        subjectToken: legacy.subjectToken,
      })
      .from(legacy)
      .innerJoin(snapshot, eq(snapshot.connectorId, legacy.connectorId))
      .where(sql`${snapshot.payload} ->> 'importId' is null`),
    db
      .select({
        connectorId: snapshot.connectorId,
        groupKey: sql<string>`${grants.groupKey}`.as('group_key'),
        subjectToken: identities.subjectToken,
      })
      .from(snapshot)
      .innerJoin(
        imports,
        and(
          eq(imports.connectorId, snapshot.connectorId),
          sql`${snapshot.payload} ->> 'importId' = ${imports.id}`,
          isNotNull(imports.completedRevision)
        )
      )
      .innerJoin(identities, eq(identities.importId, imports.id))
      .innerJoin(
        grants,
        and(eq(grants.importId, identities.importId), eq(grants.userId, identities.userId))
      )
      .where(isNotNull(grants.groupKey))
  ).as('active_connector_permission_grants')
}

/** The application has authorized this canonical source and verified the reader's subject. */
export async function hasConnectorPermissionGrant(
  connectorId: string,
  groupKey: string,
  subjectToken: string
): Promise<boolean> {
  const table = activeConnectorPermissionGrants()
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
  const table = activeConnectorPermissionGrants()
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
  const table = activeConnectorPermissionGrants()
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
export async function readConnectorPermissionMetadata(
  connectorIds: readonly string[],
  fields?: readonly string[]
) {
  const table = knowledgeConnectorPermissionSnapshot
  const metadata = fields?.length
    ? sql<Record<string, unknown>>`jsonb_build_object(${sql.join(
        fields.map((field) => sql`${field}::text, ${table.metadata} -> ${field}::text`),
        sql`, `
      )})`
    : table.metadata
  const result: Array<Pick<ConnectorPermissionSnapshot, 'connectorId' | 'revision' | 'metadata'>> =
    []
  for (let offset = 0; offset < connectorIds.length; offset += 1000) {
    result.push(
      ...(await db
        .select({
          connectorId: table.connectorId,
          revision: table.revision,
          metadata,
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
    .select({
      revision: table.revision,
      importId: sql<string | null>`${table.payload} ->> 'importId'`,
    })
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
    if (current?.importId && current.importId !== input.payload.importId)
      await enqueuePermissionImportCleanup(tx, current.importId, connectorId)
  } catch {
    /** Query exceptions may contain bind parameters from the private payload. */
    throw new OrchestrationError(
      'internal',
      'Could not save permissions. The previous configuration was preserved.'
    )
  }
  return values.revision
}
