import { db } from '@sim/db'
import { mothershipBenchmarks } from '@sim/db/schema'
import { truncate } from '@sim/utils/string'
import { and, desc, eq, gt, isNull, lt, lte, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import {
  type BenchmarkArtifacts,
  type BenchmarkCase,
  type BenchmarkStage,
  benchmarkArtifactsSchema,
  benchmarkCaseSchema,
  benchmarkSummarySchema,
} from '@/lib/benchmarks/types'
import { OrchestrationError } from '@/lib/core/orchestration/types'

export interface BenchmarkScope {
  organizationId: string
  userId: string
  benchmarkId: string
}

const summaryColumns = {
  id: mothershipBenchmarks.id,
  organizationId: mothershipBenchmarks.organizationId,
  userId: mothershipBenchmarks.userId,
  sourceWorkspaceId: mothershipBenchmarks.sourceWorkspaceId,
  name: mothershipBenchmarks.name,
  version: mothershipBenchmarks.version,
  runningStage: mothershipBenchmarks.runningStage,
  attemptId: mothershipBenchmarks.attemptId,
  leaseExpiresAt: mothershipBenchmarks.leaseExpiresAt,
  plannerChatId: mothershipBenchmarks.plannerChatId,
  error: mothershipBenchmarks.error,
  createdAt: mothershipBenchmarks.createdAt,
  updatedAt: mothershipBenchmarks.updatedAt,
}

function scopeWhere(scope: BenchmarkScope) {
  return and(
    eq(mothershipBenchmarks.id, scope.benchmarkId),
    eq(mothershipBenchmarks.organizationId, scope.organizationId),
    eq(mothershipBenchmarks.userId, scope.userId)
  )
}

function dateFields(row: { createdAt: Date; updatedAt: Date; leaseExpiresAt: Date | null }) {
  return {
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    leaseExpiresAt: row.leaseExpiresAt?.toISOString() ?? null,
  }
}

function toBenchmark(row: typeof mothershipBenchmarks.$inferSelect): BenchmarkCase {
  return benchmarkCaseSchema.parse({ ...row, ...dateFields(row) })
}

const cursorSchema = z
  .object({ id: z.string().min(1).max(128), createdAt: z.string().datetime() })
  .strict()

export async function listBenchmarkRecords(input: {
  organizationId: string
  userId: string
  limit: number
  cursor?: string
}) {
  let cursor: z.infer<typeof cursorSchema> | undefined
  if (input.cursor) {
    try {
      cursor = cursorSchema.parse(
        JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8'))
      )
    } catch {
      throw new OrchestrationError('validation', 'Invalid benchmark cursor')
    }
  }
  const rows = await db
    .select(summaryColumns)
    .from(mothershipBenchmarks)
    .where(
      and(
        eq(mothershipBenchmarks.organizationId, input.organizationId),
        eq(mothershipBenchmarks.userId, input.userId),
        cursor
          ? or(
              lt(mothershipBenchmarks.createdAt, new Date(cursor.createdAt)),
              and(
                eq(mothershipBenchmarks.createdAt, new Date(cursor.createdAt)),
                lt(mothershipBenchmarks.id, cursor.id)
              )
            )
          : undefined
      )
    )
    .orderBy(desc(mothershipBenchmarks.createdAt), desc(mothershipBenchmarks.id))
    .limit(input.limit + 1)
  const page = rows.slice(0, input.limit)
  const last = page.at(-1)
  return {
    benchmarks: page.map((row) => benchmarkSummarySchema.parse({ ...row, ...dateFields(row) })),
    nextCursor:
      rows.length > input.limit && last
        ? Buffer.from(
            JSON.stringify({ id: last.id, createdAt: last.createdAt.toISOString() })
          ).toString('base64url')
        : null,
  }
}

export async function getBenchmarkRecord(scope: BenchmarkScope): Promise<BenchmarkCase> {
  const [row] = await db.select().from(mothershipBenchmarks).where(scopeWhere(scope)).limit(1)
  if (!row) throw new OrchestrationError('not_found', 'Benchmark not found')
  return toBenchmark(row)
}

export async function createBenchmarkRecord(
  input: BenchmarkScope & { sourceWorkspaceId: string; name: string; artifacts: BenchmarkArtifacts }
) {
  const [row] = await db
    .insert(mothershipBenchmarks)
    .values({
      id: input.benchmarkId,
      organizationId: input.organizationId,
      userId: input.userId,
      sourceWorkspaceId: input.sourceWorkspaceId,
      name: input.name,
      artifacts: benchmarkArtifactsSchema.parse(input.artifacts),
    })
    .returning()
  if (!row) throw new Error('Benchmark insert returned no row')
  return toBenchmark(row)
}

function idleOrExpired(now: Date) {
  return or(
    isNull(mothershipBenchmarks.runningStage),
    lte(mothershipBenchmarks.leaseExpiresAt, now)
  )
}

function conflict(): never {
  throw new OrchestrationError(
    'conflict',
    'This benchmark changed or has an active step. Refresh it before trying again.'
  )
}

export async function updateBenchmarkRecord(
  input: BenchmarkScope & { version: number; name: string; artifacts: BenchmarkArtifacts }
) {
  const now = new Date()
  const [row] = await db
    .update(mothershipBenchmarks)
    .set({
      name: input.name,
      artifacts: benchmarkArtifactsSchema.parse(input.artifacts),
      ...(input.artifacts.generatedSpec === null ? { plannerChatId: null } : {}),
      version: sql`${mothershipBenchmarks.version} + 1`,
      runningStage: null,
      attemptId: null,
      leaseExpiresAt: null,
      error: null,
      updatedAt: now,
    })
    .where(
      and(scopeWhere(input), eq(mothershipBenchmarks.version, input.version), idleOrExpired(now))
    )
    .returning()
  if (!row) conflict()
  return toBenchmark(row)
}

export async function deleteBenchmarkRecord(input: BenchmarkScope & { version: number }) {
  const [row] = await db
    .delete(mothershipBenchmarks)
    .where(
      and(
        scopeWhere(input),
        eq(mothershipBenchmarks.version, input.version),
        idleOrExpired(new Date())
      )
    )
    .returning({ id: mothershipBenchmarks.id })
  if (!row) conflict()
}

/** A version comparison and lease claim are one write; expired attempts may be replaced. */
export async function claimBenchmarkStage(
  input: BenchmarkScope & {
    expectedVersion: number
    stage: BenchmarkStage
    attemptId: string
    leaseExpiresAt: Date
  }
) {
  const now = new Date()
  if (input.leaseExpiresAt <= now) throw new Error('Benchmark lease must expire in the future')
  const [row] = await db
    .update(mothershipBenchmarks)
    .set({
      runningStage: input.stage,
      attemptId: input.attemptId,
      leaseExpiresAt: input.leaseExpiresAt,
      error: null,
      version: sql`${mothershipBenchmarks.version} + 1`,
      updatedAt: now,
    })
    .where(
      and(
        scopeWhere(input),
        eq(mothershipBenchmarks.version, input.expectedVersion),
        idleOrExpired(now)
      )
    )
    .returning()
  if (!row) conflict()
  return toBenchmark(row)
}

interface BenchmarkAttempt extends BenchmarkScope {
  version: number
  stage: BenchmarkStage
  attemptId: string
}

function attemptWhere(input: BenchmarkAttempt) {
  return and(
    scopeWhere(input),
    eq(mothershipBenchmarks.version, input.version),
    eq(mothershipBenchmarks.runningStage, input.stage),
    eq(mothershipBenchmarks.attemptId, input.attemptId),
    gt(mothershipBenchmarks.leaseExpiresAt, new Date())
  )
}

/** A timed-out or replaced worker cannot overwrite a later run or user edit. */
export async function completeBenchmarkStage(
  input: BenchmarkAttempt & { artifacts: BenchmarkArtifacts; plannerChatId?: string | null }
) {
  const [row] = await db
    .update(mothershipBenchmarks)
    .set({
      artifacts: benchmarkArtifactsSchema.parse(input.artifacts),
      ...(input.plannerChatId !== undefined ? { plannerChatId: input.plannerChatId } : {}),
      version: sql`${mothershipBenchmarks.version} + 1`,
      runningStage: null,
      attemptId: null,
      leaseExpiresAt: null,
      error: null,
      updatedAt: new Date(),
    })
    .where(attemptWhere(input))
    .returning()
  if (!row) conflict()
  return toBenchmark(row)
}

export async function failBenchmarkStage(
  input: BenchmarkAttempt & { error: string }
): Promise<BenchmarkCase | null> {
  const [row] = await db
    .update(mothershipBenchmarks)
    .set({
      version: sql`${mothershipBenchmarks.version} + 1`,
      runningStage: null,
      attemptId: null,
      leaseExpiresAt: null,
      error: truncate(input.error, 2_000),
      updatedAt: new Date(),
    })
    .where(attemptWhere(input))
    .returning()
  return row ? toBenchmark(row) : null
}
