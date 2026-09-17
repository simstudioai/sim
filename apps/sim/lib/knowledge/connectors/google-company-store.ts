import { db } from '@sim/db'
import { knowledgeConnectorGoogleUser } from '@sim/db/schema'
import { and, asc, eq, exists, isNotNull, lte, ne, or, sql } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'
import type {
  GoogleCompanyWorkChanges,
  GoogleCompanyWorkItem,
  GoogleCompanyWorkKind,
  GoogleCompanyWorkStore,
} from '@/lib/knowledge/connectors/google-company-scheduler'
import { listingFailuresSchema, MAX_LISTING_FAILURE_SAMPLES } from '@/connectors/listing-failures'

const PERMISSION_REFRESH_MS = 12 * 60 * 60 * 1000
type Row = typeof knowledgeConnectorGoogleUser.$inferSelect
const work = knowledgeConnectorGoogleUser

function project(row: Row, kind: GoogleCompanyWorkKind): GoogleCompanyWorkItem {
  return {
    user: { id: row.userId, email: row.email, customerId: row.customerId },
    kind,
    cursor: (kind === 'content' ? row.cursor : row.permissionCursor) ?? undefined,
    attempts: kind === 'content' ? row.attempts : row.permissionAttempts,
    hasFailure: row.failure !== null || row.permissionFailure !== null,
    permissionStartedAt: row.permissionStartedAt ?? undefined,
  }
}

/** The connector's existing lease is the sole writer lease; no extra worker concurrency is introduced. */
export function googleCompanyWorkStore(
  connectorId: string,
  generationId: string,
  rescanCompleted = true
): GoogleCompanyWorkStore {
  const scope = and(eq(work.connectorId, connectorId), eq(work.generationId, generationId))
  return {
    async get(userId, kind) {
      const [row] = await db
        .select()
        .from(work)
        .where(and(scope, eq(work.userId, userId)))
        .limit(1)
      return row ? project(row, kind) : null
    },
    async next(kind, now) {
      /** A completed sweep must reach EOF instead of starting another overdue user sweep. */
      const incomplete = ne(work.status, 'complete')
      const contentEligible = rescanCompleted
        ? or(
            incomplete,
            exists(db.select({ id: work.userId }).from(work).where(and(scope, incomplete)))
          )
        : incomplete
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
          asc(work.userId)
        )
        .limit(1)
      return row ? project(row, kind) : null
    },
    async remaining() {
      const [counts] = await db
        .select({
          count: sql<number>`count(*) FILTER (WHERE ${work.status} <> 'complete')::int`,
          failures: sql<number>`count(*) FILTER (WHERE ${work.failure} IS NOT NULL OR ${work.permissionFailure} IS NOT NULL)::int`,
          retryAt: rescanCompleted
            ? sql<string | null>`min(${work.retryAt})::text`
            : sql<
                string | null
              >`min(${work.retryAt}) FILTER (WHERE ${work.status} <> 'complete')::text`,
        })
        .from(work)
        .where(scope)
      const samples = counts?.failures
        ? await db
            .select({ failure: work.failure, permissionFailure: work.permissionFailure })
            .from(work)
            .where(and(scope, or(isNotNull(work.failure), isNotNull(work.permissionFailure))))
            .orderBy(asc(work.userId))
            .limit(MAX_LISTING_FAILURE_SAMPLES)
        : []
      return {
        count: counts?.count ?? 0,
        retryAt: counts?.retryAt ? new Date(counts.retryAt) : null,
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
export async function commitGoogleCompanyWork(
  tx: DbOrTx,
  connectorId: string,
  generationId: string,
  changes: GoogleCompanyWorkChanges,
  generationStartedAt: Date
): Promise<void> {
  const scope = and(eq(work.connectorId, connectorId), eq(work.generationId, generationId))
  if (changes.enqueue?.length) {
    const at = new Date()
    await tx
      .insert(work)
      .values(
        changes.enqueue.map(({ user, cursor }) => ({
          connectorId,
          generationId,
          userId: user.id,
          email: user.email,
          customerId: user.customerId,
          cursor: cursor ?? null,
          permissionRetryAt: new Date(generationStartedAt.getTime() + PERMISSION_REFRESH_MS),
        }))
      )
      .onConflictDoUpdate({
        target: [work.connectorId, work.userId],
        set: {
          generationId,
          email: sql`excluded.email`,
          customerId: sql`excluded.customer_id`,
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
      .where(and(scope, eq(work.userId, pin.userId)))
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
      .where(and(scope, eq(work.userId, update.userId)))
  }
}
