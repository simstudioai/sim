import { db } from '@sim/db'
import { knowledgeConnectorPartition } from '@sim/db/schema'
import { and, asc, eq, exists, isNotNull, lte, ne, or, sql } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'
import type {
  ConnectorPartitionWorkChanges,
  ConnectorPartitionWorkItem,
  ConnectorPartitionWorkKind,
  ConnectorPartitionWorkStore,
} from '@/lib/knowledge/connectors/partition-work'
import {
  listingFailureSampleSchema,
  listingFailuresSchema,
  MAX_LISTING_FAILURE_SAMPLES,
} from '@/connectors/listing-failures'

type Row = typeof knowledgeConnectorPartition.$inferSelect
const work = knowledgeConnectorPartition

function project<Context>(
  row: Row,
  kind: ConnectorPartitionWorkKind,
  parseContext: (value: unknown) => Context
): ConnectorPartitionWorkItem<Context> {
  return {
    partitionKey: row.partitionKey,
    context: parseContext(row.context),
    kind,
    cursor: (kind === 'content' ? row.cursor : row.permissionCursor) ?? undefined,
    attempts: kind === 'content' ? row.attempts : row.permissionAttempts,
    hasFailure: row.failure !== null || row.permissionFailure !== null,
    failure: listingFailureSampleSchema.safeParse(
      kind === 'content' ? row.failure : row.permissionFailure
    ).data,
    permissionStartedAt: row.permissionStartedAt ?? undefined,
  }
}

/** The connector's existing lease is the sole writer lease; no extra worker concurrency is introduced. */
export function connectorPartitionWorkStore<Context>(
  connectorId: string,
  generationId: string,
  parseContext: (value: unknown) => Context,
  rescanCompleted = true
): ConnectorPartitionWorkStore<Context> {
  const scope = and(eq(work.connectorId, connectorId), eq(work.generationId, generationId))
  const contentIncomplete = ne(work.status, 'complete')
  const permissionsIncomplete = or(
    isNotNull(work.permissionCursor),
    isNotNull(work.permissionFailure)
  )
  const incomplete = or(contentIncomplete, permissionsIncomplete)
  return {
    async get(partitionKey, kind) {
      const [row] = await db
        .select()
        .from(work)
        .where(and(scope, eq(work.partitionKey, partitionKey)))
        .limit(1)
      return row ? project(row, kind, parseContext) : null
    },
    async next(kind, now) {
      /** A completed sweep must reach EOF instead of starting another overdue partition sweep. */
      const contentEligible = rescanCompleted
        ? or(
            contentIncomplete,
            exists(db.select({ id: work.partitionKey }).from(work).where(and(scope, incomplete)))
          )
        : contentIncomplete
      const [row] = await db
        .select()
        .from(work)
        .where(
          and(
            scope,
            kind === 'content'
              ? and(lte(work.retryAt, now), contentEligible)
              : and(isNotNull(work.lastServedAt), lte(work.permissionRetryAt, now))
          )
        )
        .orderBy(
          sql`${kind === 'content' ? work.lastServedAt : work.permissionLastServedAt} ASC NULLS FIRST`,
          asc(work.partitionKey)
        )
        .limit(1)
      return row ? project(row, kind, parseContext) : null
    },
    async remaining() {
      const [counts] = await db
        .select({
          count: sql<number>`count(*) FILTER (WHERE ${incomplete})::int`,
          failures: sql<number>`count(*) FILTER (WHERE ${work.failure} IS NOT NULL OR ${work.permissionFailure} IS NOT NULL)::int`,
          retryAt: sql<Date | null>`LEAST(
            min(${work.retryAt}) FILTER (WHERE ${rescanCompleted ? sql`true` : contentIncomplete}),
            min(${work.permissionRetryAt}) FILTER (WHERE ${permissionsIncomplete})
          )`.mapWith(work.retryAt),
        })
        .from(work)
        .where(scope)
      const samples = counts?.failures
        ? await db
            .select({ failure: work.failure, permissionFailure: work.permissionFailure })
            .from(work)
            .where(and(scope, or(isNotNull(work.failure), isNotNull(work.permissionFailure))))
            .orderBy(asc(work.partitionKey))
            .limit(MAX_LISTING_FAILURE_SAMPLES)
        : []
      return {
        count: counts?.count ?? 0,
        retryAt: counts?.count ? counts.retryAt : null,
        ...(counts?.failures
          ? {
              failures: listingFailuresSchema.parse({
                count: counts.failures,
                samples: samples.map((row) => row.failure ?? row.permissionFailure),
              }),
            }
          : {}),
      }
    },
  }
}

/** Called in the same transaction as the listing checkpoint, after that page's durable work. */
export async function commitConnectorPartitionWork(
  tx: DbOrTx,
  connectorId: string,
  generationId: string,
  changes: ConnectorPartitionWorkChanges,
  permissionRefreshAt: Date
): Promise<void> {
  const scope = and(eq(work.connectorId, connectorId), eq(work.generationId, generationId))
  if (changes.enqueue?.length) {
    const at = new Date()
    await tx
      .insert(work)
      .values(
        changes.enqueue.map(({ partitionKey, context, cursor }) => ({
          connectorId,
          generationId,
          partitionKey,
          context,
          cursor: cursor ?? null,
          permissionRetryAt: permissionRefreshAt,
        }))
      )
      /** Content restarts must not postpone the earlier deadline for refreshing stored permissions. */
      .onConflictDoUpdate({
        target: [work.connectorId, work.partitionKey],
        set: {
          generationId,
          context: sql`excluded.context`,
          cursor: sql`excluded.cursor`,
          status: 'pending',
          attempts: 0,
          retryAt: at,
          lastServedAt: null,
          failure: null,
          permissionCursor: null,
          permissionStartedAt: null,
          permissionFailure: null,
          permissionAttempts: 0,
        },
        setWhere: ne(work.generationId, generationId),
      })
  }
  if (changes.pin) {
    const pin = changes.pin
    await tx
      .update(work)
      .set(
        pin.kind === 'content'
          ? { cursor: pin.cursor }
          : { permissionCursor: pin.cursor, permissionStartedAt: pin.permissionStartedAt }
      )
      .where(and(scope, eq(work.partitionKey, pin.partitionKey)))
  }
  if (changes.update) {
    const update = changes.update
    const at = new Date()
    await tx
      .update(work)
      .set(
        update.kind === 'content'
          ? {
              cursor: update.cursor,
              status: update.failure ? 'blocked' : update.completed ? 'complete' : 'pending',
              retryAt: update.retryAt,
              attempts: update.attempts,
              failure: update.failure,
              lastServedAt: at,
            }
          : {
              permissionCursor: update.cursor,
              permissionRetryAt: update.retryAt,
              permissionAttempts: update.attempts,
              permissionFailure: update.failure,
              permissionLastServedAt: at,
              permissionStartedAt: update.permissionStartedAt,
            }
      )
      .where(and(scope, eq(work.partitionKey, update.partitionKey)))
  }
}
