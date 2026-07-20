import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { workflowEvalRun, workflowEvalSuite } from '@sim/db/schema'
import { getPostgresErrorCode } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, asc, desc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm'
import {
  type CreateWorkflowEvalSuiteInput,
  type UpdateWorkflowEvalSuiteInput,
  type WorkflowEvalAddTest,
  type WorkflowEvalCreateTest,
  type WorkflowEvalEvaluator,
  type WorkflowEvalGeneratedIds,
  type WorkflowEvalReplaceTest,
  type WorkflowEvalTest,
  workflowEvalTestsSchema,
} from '@/lib/api/contracts/workflow-evals'

const MAX_SUITE_PAGE_SIZE = 100
const MAX_TEST_PAGE_SIZE = 100

interface SuiteCursor {
  createdAt: string
  id: string
}

interface TestCursor {
  ordinal: number
}

export class WorkflowEvalSuiteConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkflowEvalSuiteConflictError'
  }
}

export class WorkflowEvalSuiteMutationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkflowEvalSuiteMutationError'
  }
}

function encodeCursor(value: SuiteCursor | TestCursor): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

function decodeCursor<T>(
  cursor: string | undefined,
  guard: (value: unknown) => value is T
): T | null {
  if (!cursor) return null
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    if (!guard(value)) throw new Error('Cursor shape is invalid')
    return value
  } catch {
    throw new WorkflowEvalSuiteMutationError('Invalid Eval pagination cursor')
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSuiteCursor(value: unknown): value is SuiteCursor {
  return (
    isRecord(value) &&
    typeof value.createdAt === 'string' &&
    !Number.isNaN(Date.parse(value.createdAt)) &&
    typeof value.id === 'string' &&
    value.id.length > 0
  )
}

function isTestCursor(value: unknown): value is TestCursor {
  return isRecord(value) && Number.isInteger(value.ordinal) && Number(value.ordinal) >= 0
}

function countEvaluators(tests: WorkflowEvalTest[]) {
  return tests.reduce(
    (counts, test) => ({ ...counts, [test.evaluator.type]: counts[test.evaluator.type] + 1 }),
    { code: 0, agent: 0, workflow: 0 }
  )
}

function materializeEvaluator({
  evaluator,
  testRef,
  generatedIds,
  allowedCriterionIds,
}: {
  evaluator: WorkflowEvalCreateTest['evaluator'] | WorkflowEvalReplaceTest['evaluator']
  testRef: string
  generatedIds: WorkflowEvalGeneratedIds
  allowedCriterionIds?: Set<string>
}): WorkflowEvalEvaluator {
  if (evaluator.type !== 'agent') return evaluator

  return {
    ...evaluator,
    criteria: evaluator.criteria.map((criterion) => {
      if ('id' in criterion) {
        if (!allowedCriterionIds?.has(criterion.id)) {
          throw new WorkflowEvalSuiteMutationError(
            `Criterion ${criterion.id} does not belong to test ${testRef}`
          )
        }
        return criterion
      }
      const id = generateId()
      generatedIds.criteria[`${testRef}/${criterion.clientRef}`] = id
      return { id, name: criterion.name, description: criterion.description }
    }),
  }
}

function materializeNewTest(
  test: WorkflowEvalCreateTest | WorkflowEvalAddTest,
  generatedIds: WorkflowEvalGeneratedIds
): WorkflowEvalTest {
  if (generatedIds.tests[test.clientRef]) {
    throw new WorkflowEvalSuiteMutationError(`Duplicate test clientRef ${test.clientRef}`)
  }
  const id = generateId()
  generatedIds.tests[test.clientRef] = id
  return {
    id,
    name: test.name,
    input: test.input,
    mocks: test.mocks,
    errorBlockIds: test.errorBlockIds,
    evaluator: materializeEvaluator({
      evaluator: test.evaluator,
      testRef: test.clientRef,
      generatedIds,
    }),
  }
}

function materializeReplacement(
  replacement: WorkflowEvalReplaceTest,
  existing: WorkflowEvalTest,
  generatedIds: WorkflowEvalGeneratedIds
): WorkflowEvalTest {
  const allowedCriterionIds = new Set(
    existing.evaluator.type === 'agent'
      ? existing.evaluator.criteria.map((criterion) => criterion.id)
      : []
  )
  return {
    id: existing.id,
    name: replacement.name,
    input: replacement.input,
    mocks: replacement.mocks,
    errorBlockIds: replacement.errorBlockIds,
    evaluator: materializeEvaluator({
      evaluator: replacement.evaluator,
      testRef: replacement.testId,
      generatedIds,
      allowedCriterionIds,
    }),
  }
}

function parseStoredTests(suiteId: string, value: unknown): WorkflowEvalTest[] {
  const parsed = workflowEvalTestsSchema.safeParse(value)
  if (!parsed.success) {
    throw new Error(`Workflow eval suite ${suiteId} contains an invalid persisted definition`)
  }
  return parsed.data
}

function normalizeLimit(limit: number | undefined, maximum: number): number {
  if (limit === undefined) return Math.min(50, maximum)
  if (!Number.isInteger(limit) || limit < 1 || limit > maximum) {
    throw new WorkflowEvalSuiteMutationError(`limit must be between 1 and ${maximum}`)
  }
  return limit
}

export async function listWorkflowEvalSuites({
  workflowId,
  includeArchived = false,
  limit,
  cursor,
}: {
  workflowId: string
  includeArchived?: boolean
  limit?: number
  cursor?: string
}) {
  const pageSize = normalizeLimit(limit, MAX_SUITE_PAGE_SIZE)
  const decoded = decodeCursor(cursor, isSuiteCursor)
  const cursorCondition = decoded
    ? or(
        gt(workflowEvalSuite.createdAt, new Date(decoded.createdAt)),
        and(
          eq(workflowEvalSuite.createdAt, new Date(decoded.createdAt)),
          gt(workflowEvalSuite.id, decoded.id)
        )
      )
    : undefined
  const archiveCondition = includeArchived ? undefined : isNull(workflowEvalSuite.archivedAt)
  const rows = await db
    .select({
      id: workflowEvalSuite.id,
      name: workflowEvalSuite.name,
      definitionRevision: workflowEvalSuite.definitionRevision,
      tests: workflowEvalSuite.tests,
      archivedAt: workflowEvalSuite.archivedAt,
      createdAt: workflowEvalSuite.createdAt,
      updatedAt: workflowEvalSuite.updatedAt,
    })
    .from(workflowEvalSuite)
    .where(and(eq(workflowEvalSuite.workflowId, workflowId), archiveCondition, cursorCondition))
    .orderBy(asc(workflowEvalSuite.createdAt), asc(workflowEvalSuite.id))
    .limit(pageSize + 1)

  const page = rows.slice(0, pageSize)
  const suiteIds = page.map((row) => row.id)
  const latestRuns =
    suiteIds.length === 0
      ? []
      : await db
          .selectDistinctOn([workflowEvalRun.suiteId], {
            id: workflowEvalRun.id,
            suiteId: workflowEvalRun.suiteId,
            status: workflowEvalRun.status,
            passedCount: workflowEvalRun.passedCount,
            warningCount: workflowEvalRun.warningCount,
            failedCount: workflowEvalRun.failedCount,
            errorCount: workflowEvalRun.errorCount,
            totalCount: workflowEvalRun.totalCount,
            createdAt: workflowEvalRun.createdAt,
          })
          .from(workflowEvalRun)
          .where(inArray(workflowEvalRun.suiteId, suiteIds))
          .orderBy(
            workflowEvalRun.suiteId,
            desc(workflowEvalRun.createdAt),
            desc(workflowEvalRun.id)
          )
  const latestBySuiteId = new Map(latestRuns.map((run) => [run.suiteId, run]))

  const last = page.at(-1)
  return {
    items: page.map((row) => {
      const tests = parseStoredTests(row.id, row.tests)
      const latestRun = latestBySuiteId.get(row.id) ?? null
      return {
        id: row.id,
        name: row.name,
        definitionRevision: row.definitionRevision,
        testCount: tests.length,
        evaluatorCounts: countEvaluators(tests),
        archivedAt: row.archivedAt,
        updatedAt: row.updatedAt,
        latestRun,
      }
    }),
    nextCursor:
      rows.length > pageSize && last
        ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
        : null,
  }
}

export async function getWorkflowEvalSuite({
  workflowId,
  suiteId,
  testIds,
  limit,
  cursor,
}: {
  workflowId: string
  suiteId: string
  testIds?: string[]
  limit?: number
  cursor?: string
}) {
  const [suite] = await db
    .select()
    .from(workflowEvalSuite)
    .where(and(eq(workflowEvalSuite.id, suiteId), eq(workflowEvalSuite.workflowId, workflowId)))
    .limit(1)
  if (!suite)
    throw new WorkflowEvalSuiteMutationError(`Workflow eval suite ${suiteId} was not found`)

  const tests = parseStoredTests(suiteId, suite.tests)
  const requested = testIds
    ? testIds.map((testId) => {
        const test = tests.find((candidate) => candidate.id === testId)
        if (!test) {
          throw new WorkflowEvalSuiteMutationError(
            `Workflow eval test ${testId} was not found in suite ${suiteId}`
          )
        }
        return test
      })
    : tests
  const pageSize = normalizeLimit(limit, MAX_TEST_PAGE_SIZE)
  const decoded = decodeCursor(cursor, isTestCursor)
  const start = decoded?.ordinal ?? 0
  if (start > requested.length) {
    throw new WorkflowEvalSuiteMutationError('Eval test cursor is outside the suite definition')
  }
  const page = requested.slice(start, start + pageSize)
  const nextOrdinal = start + page.length

  return {
    id: suite.id,
    workflowId: suite.workflowId,
    name: suite.name,
    definitionVersion: suite.definitionVersion,
    definitionRevision: suite.definitionRevision,
    archivedAt: suite.archivedAt,
    createdAt: suite.createdAt,
    updatedAt: suite.updatedAt,
    tests: page,
    nextCursor: nextOrdinal < requested.length ? encodeCursor({ ordinal: nextOrdinal }) : null,
  }
}

export async function createWorkflowEvalSuite({
  workflowId,
  workspaceId,
  userId,
  input,
}: {
  workflowId: string
  workspaceId: string
  userId: string
  input: CreateWorkflowEvalSuiteInput
}) {
  const generatedIds: WorkflowEvalGeneratedIds = { tests: {}, criteria: {} }
  const tests = workflowEvalTestsSchema.parse(
    input.tests.map((test) => materializeNewTest(test, generatedIds))
  )
  const id = generateId()
  const createdAt = new Date()
  try {
    await db.insert(workflowEvalSuite).values({
      id,
      workflowId,
      name: input.name,
      definitionVersion: 1,
      definitionRevision: 1,
      tests,
      archivedAt: null,
      createdByUserId: userId,
      createdAt,
      updatedAt: createdAt,
    })
  } catch (error) {
    if (getPostgresErrorCode(error) === '23505') {
      throw new WorkflowEvalSuiteConflictError(
        `Workflow ${workflowId} already has an Eval suite named ${input.name}`
      )
    }
    throw error
  }

  recordAudit({
    workspaceId,
    actorId: userId,
    action: AuditAction.WORKFLOW_EVAL_SUITE_CREATED,
    resourceType: AuditResourceType.WORKFLOW,
    resourceId: workflowId,
    description: `Created Eval suite ${input.name}`,
    metadata: { suiteId: id, definitionRevision: 1 },
  })

  return {
    id,
    workflowId,
    name: input.name,
    definitionVersion: 1 as const,
    definitionRevision: 1,
    testCount: tests.length,
    evaluatorCounts: countEvaluators(tests),
    generatedIds,
    createdAt,
    updatedAt: createdAt,
  }
}

function applySuitePatch({
  existingTests,
  input,
  generatedIds,
}: {
  existingTests: WorkflowEvalTest[]
  input: UpdateWorkflowEvalSuiteInput
  generatedIds: WorkflowEvalGeneratedIds
}): WorkflowEvalTest[] {
  const byId = new Map(existingTests.map((test) => [test.id, test]))
  const removeIds = new Set(input.removeTestIds ?? [])
  const replacementIds = new Set<string>()
  for (const replacement of input.replaceTests ?? []) {
    if (replacementIds.has(replacement.testId)) {
      throw new WorkflowEvalSuiteMutationError(
        `Test ${replacement.testId} is replaced more than once`
      )
    }
    if (removeIds.has(replacement.testId)) {
      throw new WorkflowEvalSuiteMutationError(
        `Test ${replacement.testId} cannot be replaced and removed together`
      )
    }
    const existing = byId.get(replacement.testId)
    if (!existing) throw new WorkflowEvalSuiteMutationError(`Unknown test ${replacement.testId}`)
    replacementIds.add(replacement.testId)
    byId.set(replacement.testId, materializeReplacement(replacement, existing, generatedIds))
  }
  for (const testId of removeIds) {
    if (!byId.delete(testId)) throw new WorkflowEvalSuiteMutationError(`Unknown test ${testId}`)
  }

  const orderedExisting = existingTests
    .filter((test) => byId.has(test.id))
    .map((test) => byId.get(test.id) as WorkflowEvalTest)
  for (const addition of input.addTests ?? []) {
    const test = materializeNewTest(addition, generatedIds)
    if (addition.afterTestId === null) {
      orderedExisting.unshift(test)
      continue
    }
    if (addition.afterTestId === undefined) {
      orderedExisting.push(test)
      continue
    }
    const afterIndex = orderedExisting.findIndex(
      (candidate) => candidate.id === addition.afterTestId
    )
    if (afterIndex === -1) {
      throw new WorkflowEvalSuiteMutationError(`Unknown afterTestId ${addition.afterTestId}`)
    }
    orderedExisting.splice(afterIndex + 1, 0, test)
  }

  if (input.orderedTestIds) {
    if (
      input.orderedTestIds.length !== orderedExisting.length ||
      new Set(input.orderedTestIds).size !== input.orderedTestIds.length
    ) {
      throw new WorkflowEvalSuiteMutationError(
        'orderedTestIds must contain every surviving test exactly once'
      )
    }
    const nextById = new Map(orderedExisting.map((test) => [test.id, test]))
    return input.orderedTestIds.map((testId) => {
      const test = nextById.get(testId)
      if (!test) {
        throw new WorkflowEvalSuiteMutationError(
          `orderedTestIds contains unknown or removed test ${testId}`
        )
      }
      return test
    })
  }

  return orderedExisting
}

export async function updateWorkflowEvalSuite({
  workflowId,
  workspaceId,
  userId,
  input,
  assertNotAborted,
}: {
  workflowId: string
  workspaceId: string
  userId: string
  input: UpdateWorkflowEvalSuiteInput
  assertNotAborted?: () => void
}) {
  const generatedIds: WorkflowEvalGeneratedIds = { tests: {}, criteria: {} }
  const result = await db.transaction(async (tx) => {
    const [suite] = await tx
      .select()
      .from(workflowEvalSuite)
      .where(
        and(eq(workflowEvalSuite.id, input.suiteId), eq(workflowEvalSuite.workflowId, workflowId))
      )
      .limit(1)
    if (!suite) {
      throw new WorkflowEvalSuiteMutationError(`Workflow eval suite ${input.suiteId} was not found`)
    }
    if (suite.archivedAt) {
      throw new WorkflowEvalSuiteMutationError(`Workflow eval suite ${input.suiteId} is archived`)
    }
    if (suite.definitionRevision !== input.expectedDefinitionRevision) {
      throw new WorkflowEvalSuiteConflictError(
        `Workflow eval suite ${input.suiteId} revision conflict: expected ${input.expectedDefinitionRevision}, found ${suite.definitionRevision}`
      )
    }

    const tests = workflowEvalTestsSchema.parse(
      applySuitePatch({
        existingTests: parseStoredTests(suite.id, suite.tests),
        input,
        generatedIds,
      })
    )
    if (tests.length === 0) {
      throw new WorkflowEvalSuiteMutationError('An Eval suite must contain at least one test')
    }
    const name = input.renameTo ?? suite.name
    const updatedAt = new Date()
    assertNotAborted?.()
    const [updated] = await tx
      .update(workflowEvalSuite)
      .set({
        name,
        tests,
        definitionRevision: sql`${workflowEvalSuite.definitionRevision} + 1`,
        updatedAt,
      })
      .where(
        and(
          eq(workflowEvalSuite.id, input.suiteId),
          eq(workflowEvalSuite.workflowId, workflowId),
          eq(workflowEvalSuite.definitionRevision, input.expectedDefinitionRevision),
          isNull(workflowEvalSuite.archivedAt)
        )
      )
      .returning({ definitionRevision: workflowEvalSuite.definitionRevision })
    if (!updated) {
      throw new WorkflowEvalSuiteConflictError(
        `Workflow eval suite ${input.suiteId} changed while the update was being applied`
      )
    }
    return { name, tests, updatedAt, definitionRevision: updated.definitionRevision }
  })

  recordAudit({
    workspaceId,
    actorId: userId,
    action: AuditAction.WORKFLOW_EVAL_SUITE_UPDATED,
    resourceType: AuditResourceType.WORKFLOW,
    resourceId: workflowId,
    description: `Updated Eval suite ${result.name}`,
    metadata: {
      suiteId: input.suiteId,
      priorDefinitionRevision: input.expectedDefinitionRevision,
      definitionRevision: result.definitionRevision,
    },
  })

  return {
    id: input.suiteId,
    workflowId,
    name: result.name,
    definitionVersion: 1 as const,
    definitionRevision: result.definitionRevision,
    testCount: result.tests.length,
    evaluatorCounts: countEvaluators(result.tests),
    generatedIds,
    updatedAt: result.updatedAt,
  }
}

export async function archiveWorkflowEvalSuite({
  workflowId,
  workspaceId,
  userId,
  suiteId,
  expectedDefinitionRevision,
  assertNotAborted,
}: {
  workflowId: string
  workspaceId: string
  userId: string
  suiteId: string
  expectedDefinitionRevision: number
  assertNotAborted?: () => void
}) {
  const archivedAt = await db.transaction(async (tx) => {
    const [suite] = await tx
      .select({
        definitionRevision: workflowEvalSuite.definitionRevision,
        archivedAt: workflowEvalSuite.archivedAt,
      })
      .from(workflowEvalSuite)
      .where(and(eq(workflowEvalSuite.id, suiteId), eq(workflowEvalSuite.workflowId, workflowId)))
      .limit(1)
    if (!suite)
      throw new WorkflowEvalSuiteMutationError(`Workflow eval suite ${suiteId} was not found`)
    if (suite.archivedAt)
      throw new WorkflowEvalSuiteMutationError(`Workflow eval suite ${suiteId} is archived`)
    if (suite.definitionRevision !== expectedDefinitionRevision) {
      throw new WorkflowEvalSuiteConflictError(
        `Workflow eval suite ${suiteId} revision conflict: expected ${expectedDefinitionRevision}, found ${suite.definitionRevision}`
      )
    }
    const [activeRun] = await tx
      .select({ id: workflowEvalRun.id })
      .from(workflowEvalRun)
      .where(
        and(
          eq(workflowEvalRun.suiteId, suiteId),
          inArray(workflowEvalRun.status, ['queued', 'running'])
        )
      )
      .limit(1)
    if (activeRun) {
      throw new WorkflowEvalSuiteConflictError(
        `Workflow eval suite ${suiteId} has active run ${activeRun.id}`
      )
    }

    const now = new Date()
    assertNotAborted?.()
    const [updated] = await tx
      .update(workflowEvalSuite)
      .set({
        archivedAt: now,
        definitionRevision: sql`${workflowEvalSuite.definitionRevision} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(workflowEvalSuite.id, suiteId),
          eq(workflowEvalSuite.workflowId, workflowId),
          eq(workflowEvalSuite.definitionRevision, expectedDefinitionRevision),
          isNull(workflowEvalSuite.archivedAt)
        )
      )
      .returning({ definitionRevision: workflowEvalSuite.definitionRevision })
    if (!updated) {
      throw new WorkflowEvalSuiteConflictError(
        `Workflow eval suite ${suiteId} changed while archive was being applied`
      )
    }
    return { at: now, definitionRevision: updated.definitionRevision }
  })

  recordAudit({
    workspaceId,
    actorId: userId,
    action: AuditAction.WORKFLOW_EVAL_SUITE_ARCHIVED,
    resourceType: AuditResourceType.WORKFLOW,
    resourceId: workflowId,
    description: `Archived Eval suite ${suiteId}`,
    metadata: { suiteId, definitionRevision: archivedAt.definitionRevision },
  })

  return {
    suiteId,
    definitionRevision: archivedAt.definitionRevision,
    archivedAt: archivedAt.at,
  }
}
