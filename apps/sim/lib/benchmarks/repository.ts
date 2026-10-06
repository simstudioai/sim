import { createHash } from 'node:crypto'
import { db } from '@sim/db'
import { mothershipBenchmarkRuns, mothershipBenchmarks } from '@sim/db/schema'
import { omit } from '@sim/utils/object'
import { compareStrings, truncate } from '@sim/utils/string'
import { and, desc, eq, gt, isNull, lt, lte, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import {
  type BenchmarkArtifacts,
  type BenchmarkCase,
  type BenchmarkStage,
  benchmarkArtifactsSchema,
  benchmarkCaseSchema,
  benchmarkRunSchema,
  benchmarkRunSummarySchema,
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
  runAsUserId: mothershipBenchmarks.runAsUserId,
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

function readCursor(value?: string) {
  if (!value) return undefined
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')))
  } catch {
    throw new OrchestrationError('validation', 'Invalid benchmark cursor')
  }
}

function nextCursor(rows: { id: string; cursorCreatedAt: string }[], limit: number) {
  const last = rows[limit - 1]
  return rows.length > limit && last
    ? Buffer.from(JSON.stringify({ id: last.id, createdAt: last.cursorCreatedAt })).toString(
        'base64url'
      )
    : null
}

export async function listBenchmarkRecords(input: {
  organizationId: string
  userId: string
  limit: number
  cursor?: string
  runAsUserId?: string
}) {
  const cursor = readCursor(input.cursor)
  const rows = await db
    .select({
      ...summaryColumns,
      cursorCreatedAt: sql<string>`to_char(${mothershipBenchmarks.createdAt}, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
    })
    .from(mothershipBenchmarks)
    .where(
      and(
        eq(mothershipBenchmarks.organizationId, input.organizationId),
        eq(mothershipBenchmarks.userId, input.userId),
        input.runAsUserId
          ? eq(
              sql`coalesce(${mothershipBenchmarks.runAsUserId}, ${mothershipBenchmarks.userId})`,
              input.runAsUserId
            )
          : undefined,
        cursor
          ? or(
              lt(mothershipBenchmarks.createdAt, sql`${cursor.createdAt}::timestamp`),
              and(
                eq(mothershipBenchmarks.createdAt, sql`${cursor.createdAt}::timestamp`),
                lt(mothershipBenchmarks.id, cursor.id)
              )
            )
          : undefined
      )
    )
    .orderBy(desc(mothershipBenchmarks.createdAt), desc(mothershipBenchmarks.id))
    .limit(input.limit + 1)
  const page = rows.slice(0, input.limit)
  return {
    benchmarks: page.map((row) => benchmarkSummarySchema.parse({ ...row, ...dateFields(row) })),
    nextCursor: nextCursor(rows, input.limit),
  }
}

export async function getBenchmarkRecord(scope: BenchmarkScope): Promise<BenchmarkCase> {
  const [row] = await db.select().from(mothershipBenchmarks).where(scopeWhere(scope)).limit(1)
  if (!row) throw new OrchestrationError('not_found', 'Benchmark not found')
  return toBenchmark(row)
}

export async function createBenchmarkRecord(
  input: BenchmarkScope & {
    sourceWorkspaceId: string
    name: string
    artifacts: BenchmarkArtifacts
    runAsUserId?: string
  }
) {
  const [row] = await db
    .insert(mothershipBenchmarks)
    .values({
      id: input.benchmarkId,
      organizationId: input.organizationId,
      userId: input.userId,
      runAsUserId: input.runAsUserId,
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

export interface BenchmarkAttempt extends BenchmarkScope {
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

/** Renewal fences abandoned attempts without imposing a maximum duration on their live owner. */
export async function renewBenchmarkStage(
  input: BenchmarkAttempt & { leaseExpiresAt: Date }
): Promise<boolean> {
  if (input.leaseExpiresAt <= new Date())
    throw new Error('Benchmark lease must expire in the future')
  const [row] = await db
    .update(mothershipBenchmarks)
    .set({ leaseExpiresAt: input.leaseExpiresAt })
    .where(attemptWhere(input))
    .returning({ id: mothershipBenchmarks.id })
  return Boolean(row)
}

/** A timed-out or replaced worker cannot overwrite a later run or user edit. */
export async function completeBenchmarkStage(
  input: BenchmarkAttempt & {
    artifacts: BenchmarkArtifacts
    plannerChatId?: string | null
    runLabel?: string
  }
) {
  return db.transaction(async (tx) => {
    const [row] = await tx
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
    const benchmark = toBenchmark(row)
    if (input.stage === 'grade') {
      const artifacts = benchmark.artifacts
      const snapshot = benchmarkRunSchema.parse({
        execution: {
          organizationId: benchmark.organizationId,
          sourceWorkspaceId: benchmark.sourceWorkspaceId,
          operatorUserId: benchmark.userId,
          runAsUserId: benchmark.runAsUserId ?? benchmark.userId,
        },
        id: input.attemptId,
        benchmarkId: benchmark.id,
        label: input.runLabel ?? '',
        evaluationKey: createHash('sha256')
          .update(
            JSON.stringify([
              artifacts.recoveryMode === 'references' ? 3 : 2,
              benchmark.organizationId,
              benchmark.runAsUserId ?? benchmark.userId,
              benchmark.sourceWorkspaceId,
              artifacts.taskBrief,
              artifacts.referenceSpec,
              artifacts.redactedSpec,
              [...artifacts.blanks].sort((a, b) => compareStrings(a.id, b.id)),
            ])
          )
          .digest('hex'),
        correct: artifacts.grade?.filter((result) => result.correct).length ?? 0,
        automaticCorrect: artifacts.grade?.filter((result) => result.correct).length ?? 0,
        total: artifacts.blanks.length,
        version: 1,
        reviewedCount: 0,
        reviewedAt: null,
        reviews: [],
        artifacts,
        createdAt: row.updatedAt.toISOString(),
      })
      await tx.insert(mothershipBenchmarkRuns).values({
        ...omit(snapshot, ['reviewedCount', 'execution']),
        createdAt: row.updatedAt,
        reviewedAt: null,
      })
    }
    return benchmark
  })
}

const runSummaryColumns = {
  id: mothershipBenchmarkRuns.id,
  benchmarkId: mothershipBenchmarkRuns.benchmarkId,
  label: mothershipBenchmarkRuns.label,
  evaluationKey: mothershipBenchmarkRuns.evaluationKey,
  correct: mothershipBenchmarkRuns.correct,
  automaticCorrect: mothershipBenchmarkRuns.automaticCorrect,
  total: mothershipBenchmarkRuns.total,
  version: mothershipBenchmarkRuns.version,
  reviewedCount: sql<number>`jsonb_array_length(${mothershipBenchmarkRuns.reviews})`,
  reviewedAt: mothershipBenchmarkRuns.reviewedAt,
  createdAt: mothershipBenchmarkRuns.createdAt,
}

const runExecutionColumns = {
  organizationId: mothershipBenchmarks.organizationId,
  sourceWorkspaceId: mothershipBenchmarks.sourceWorkspaceId,
  operatorUserId: mothershipBenchmarks.userId,
  runAsUserId: sql<string>`coalesce(${mothershipBenchmarks.runAsUserId}, ${mothershipBenchmarks.userId})`,
}

export async function listBenchmarkRunRecords(
  input: BenchmarkScope & { limit: number; cursor?: string }
) {
  const cursor = readCursor(input.cursor)
  const limit = Math.max(1, Math.min(input.limit, 50))
  const rows = await db
    .select({
      ...runSummaryColumns,
      cursorCreatedAt: sql<string>`to_char(${mothershipBenchmarkRuns.createdAt}, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
    })
    .from(mothershipBenchmarkRuns)
    .innerJoin(
      mothershipBenchmarks,
      eq(mothershipBenchmarks.id, mothershipBenchmarkRuns.benchmarkId)
    )
    .where(
      and(
        scopeWhere(input),
        cursor
          ? or(
              lt(mothershipBenchmarkRuns.createdAt, sql`${cursor.createdAt}::timestamp`),
              and(
                eq(mothershipBenchmarkRuns.createdAt, sql`${cursor.createdAt}::timestamp`),
                lt(mothershipBenchmarkRuns.id, cursor.id)
              )
            )
          : undefined
      )
    )
    .orderBy(desc(mothershipBenchmarkRuns.createdAt), desc(mothershipBenchmarkRuns.id))
    .limit(limit + 1)
  return {
    runs: rows.slice(0, limit).map((row) =>
      benchmarkRunSummarySchema.parse({
        ...row,
        createdAt: row.createdAt.toISOString(),
        reviewedAt: row.reviewedAt?.toISOString() ?? null,
      })
    ),
    nextCursor: nextCursor(rows, limit),
  }
}

export async function getBenchmarkRunRecord(input: BenchmarkScope & { runId: string }) {
  const [row] = await db
    .select({
      ...runSummaryColumns,
      execution: runExecutionColumns,
      artifacts: mothershipBenchmarkRuns.artifacts,
      reviews: mothershipBenchmarkRuns.reviews,
    })
    .from(mothershipBenchmarkRuns)
    .innerJoin(
      mothershipBenchmarks,
      eq(mothershipBenchmarks.id, mothershipBenchmarkRuns.benchmarkId)
    )
    .where(and(scopeWhere(input), eq(mothershipBenchmarkRuns.id, input.runId)))
    .limit(1)
  if (!row) throw new OrchestrationError('not_found', 'Benchmark run not found')
  return benchmarkRunSchema.parse({
    ...row,
    createdAt: row.createdAt.toISOString(),
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
  })
}

export async function reviewBenchmarkRunRecord(
  input: BenchmarkScope & {
    runId: string
    version: number
    blankId: string
    correct: boolean | null
    note: string
  }
) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        ...runSummaryColumns,
        execution: runExecutionColumns,
        artifacts: mothershipBenchmarkRuns.artifacts,
        reviews: mothershipBenchmarkRuns.reviews,
      })
      .from(mothershipBenchmarkRuns)
      .innerJoin(
        mothershipBenchmarks,
        eq(mothershipBenchmarks.id, mothershipBenchmarkRuns.benchmarkId)
      )
      .where(and(scopeWhere(input), eq(mothershipBenchmarkRuns.id, input.runId)))
      .limit(1)
      .for('update', { of: mothershipBenchmarkRuns })
    if (!row) throw new OrchestrationError('not_found', 'Benchmark run not found')
    if (row.version !== input.version)
      throw new OrchestrationError('conflict', 'This review changed. Refresh it before saving.')
    const current = benchmarkRunSchema.parse({
      ...row,
      createdAt: row.createdAt.toISOString(),
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
    })
    if (!current.artifacts.blanks.some((blank) => blank.id === input.blankId))
      throw new OrchestrationError('validation', 'This detail does not belong to the saved run')
    const reviews = current.reviews.filter((review) => review.id !== input.blankId)
    if (input.correct !== null)
      reviews.push({ id: input.blankId, correct: input.correct, note: input.note })
    const overrides = new Map(reviews.map((review) => [review.id, review.correct]))
    const reviewedAt = new Date()
    const next = benchmarkRunSchema.parse({
      ...current,
      reviews,
      reviewedCount: reviews.length,
      correct: current.artifacts.grade.filter((grade) => overrides.get(grade.id) ?? grade.correct)
        .length,
      version: current.version + 1,
      reviewedAt: reviewedAt.toISOString(),
    })
    await tx
      .update(mothershipBenchmarkRuns)
      .set({
        reviews: next.reviews,
        correct: next.correct,
        version: next.version,
        reviewedAt,
      })
      .where(eq(mothershipBenchmarkRuns.id, input.runId))
    return next
  })
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
