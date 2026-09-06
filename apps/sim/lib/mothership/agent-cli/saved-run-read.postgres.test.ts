/**
 * @vitest-environment node
 *
 * Opt in with MSHIP_TEST_DATABASE_URL pointing to a local mship_audit_* database.
 * SIM_HELPERS_SMOKE=1 also runs the actual service/DAG/Function runtime and log writer.
 * CLI, routes, canonical scope, application authorization, SQL and display projection
 * are real. Execution traces live in local files; cache clearing forces physical reads.
 * Authentication, membership, saved drafts, admission, billing, ownership registration
 * and external effects are fixtures. Seeded cases also bypass execution/log writing.
 * Isolated columns plus required defaults/indexes do not prove migrations or all constraints.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DelegatedPrincipal } from '@sim/auth/principal'
import { db } from '@sim/db'
import {
  folder,
  organization,
  pausedExecutions,
  resumeQueue,
  usageLog,
  user,
  workflow,
  workflowDeploymentVersion,
  workflowExecutionLogs,
  workflowExecutionSnapshots,
  workspace,
} from '@sim/db/schema'
import type { PermissionType } from '@sim/platform-authz/workspace'
import { generateId } from '@sim/utils/id'
import { eq, sql } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { NextRequest } from 'next/server'
import type { EmbeddedCliIdentity } from 'sim/embed'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { v2LogDetailSchema } from '@/lib/api/contracts/v2/logs'
import {
  v2ExecuteWorkflowDataSchema,
  v2WorkflowRunStatusSchema,
} from '@/lib/api/contracts/v2/workflows'
import { clearLargeValueCacheForTests } from '@/lib/execution/payloads/cache'
import { isLargeValueRef } from '@/lib/execution/payloads/large-value-ref'
import { executeInSandbox, executeShellInSandbox } from '@/lib/execution/remote-sandbox'
import type { CreateExecutorPrincipalFromExecutionContextInput } from '@/lib/internal/principals/executor'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import { SECRET_PROJECTION_VERSION } from '@/lib/logs/execution/trace-store'
import { runCli } from '@/lib/mothership/agent-cli/run-cli'
import { GET as logRoute } from '@/app/api/v2/logs/[runId]/route'
import { POST as executeRoute } from '@/app/api/v2/workflows/[workflowId]/execute/route'
import { GET as runRoute } from '@/app/api/v2/workflows/[workflowId]/runs/[runId]/route'
import type { BlockState } from '@/stores/workflows/workflow/types'

const fixture = vi.hoisted(() => ({
  close: async () => {},
  permission: 'read' as PermissionType | null,
  requests: [] as string[],
  errors: [] as unknown[],
  saved: new Map<string, ReturnType<typeof runnableState>>(),
  directory: '',
  storageReads: [] as string[],
  storageKeys: new Map<string, string>(),
}))
vi.mock('@sim/logger', async () => {
  const { loggerMock, createMockLogger } = await import('@sim/testing')
  const logger = createMockLogger()
  logger.error.mockImplementation((...args: unknown[]) => fixture.errors.push(args))
  logger.withMetadata.mockReturnValue(logger)
  logger.child.mockReturnValue(logger)
  return { ...loggerMock, createLogger: () => logger }
})
vi.unmock('@/blocks/registry')
vi.unmock('@/tools/registry')
vi.unmock('@sim/db/schema')
vi.unmock('drizzle-orm')
vi.mock('@sim/db', async () => {
  const url = process.env.MSHIP_TEST_DATABASE_URL
  if (!url) return (await import('@sim/testing')).databaseMock
  const parsed = new URL(url)
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) ||
    !parsed.pathname.startsWith('/mship_audit_')
  ) {
    throw new Error('Expected a local disposable audit database')
  }
  const { default: postgres } = await import('postgres')
  const { drizzle } = await import('drizzle-orm/postgres-js')
  const client = postgres(url, { max: 1, onnotice: () => {} })
  const database = drizzle(client)
  fixture.close = () => client.end()
  return {
    ...(await import('@sim/db/schema')),
    db: database,
    dbReplica: database,
    dbFor: () => database,
  }
})
vi.mock('@/lib/api/server/routes/v2-api-key-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/server/routes/v2-api-key-auth')>()),
  authenticateV2ApiKey: async () => ({
    principal: { kind: 'personal_api_key', userId: 'run-reader', keyId: 'local-key' },
    rateLimitSubjectIds: ['user:run-reader'],
    rateLimitSubscription: null,
    keyType: 'personal',
    keyExpiresAt: null,
  }),
}))
vi.mock('@sim/platform-authz/workspace', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@sim/platform-authz/workspace')>()),
  resolveEffectiveWorkspacePermission: async () => fixture.permission,
}))
vi.mock('@/lib/core/rate-limiter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/core/rate-limiter')>()),
  getRateLimit: () => ({ maxTokens: 100, refillRate: 50, refillIntervalMs: 60_000 }),
  RateLimiter: class {
    async checkRateLimitDirectOrThrow() {
      return { allowed: true, remaining: 99, resetAt: new Date() }
    }
    async checkRateLimitDirect() {
      return { allowed: true, remaining: 99, resetAt: new Date() }
    }
  },
}))
vi.mock('@/lib/logs/cost-ledger', () => ({ buildCostLedger: async () => null }))
vi.mock('@/lib/core/async-jobs', () => ({
  getJobQueue: async () => ({ getJob: async () => null }),
}))

vi.mock('@/lib/workflows/persistence/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/workflows/persistence/utils')>()),
  loadWorkflowFromNormalizedTables: async (id: string) =>
    structuredClone(fixture.saved.get(id) ?? null),
}))
vi.mock('@/lib/execution/preprocessing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/execution/preprocessing')>()),
  preprocessExecution: async ({ workflowId: id }: { workflowId: string }) => ({
    success: true,
    actorUserId: 'run-reader',
    workflowRecord: (await db.select().from(workflow).where(eq(workflow.id, id)))[0],
    actorSubscription: { plan: 'pro' },
    billingAttribution: {
      actorUserId: 'run-reader',
      workspaceId,
      organizationId: null,
      billedAccountUserId: 'run-reader',
      billingEntity: { type: 'user', id: 'run-reader' },
      billingPeriod: { start: '2026-09-01T00:00:00.000Z', end: '2026-10-01T00:00:00.000Z' },
      payerSubscription: null,
    },
    executionTimeout: { sync: 20_000, async: 20_000 },
  }),
}))
vi.mock('@/lib/internal/principals/executor', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/internal/principals/executor')>()),
  createExecutorPrincipalFromExecutionContext: async ({
    audience,
    context,
  }: CreateExecutorPrincipalFromExecutionContextInput): Promise<DelegatedPrincipal> => ({
    kind: 'delegated',
    serviceId: 'executor',
    subjectUserId: 'run-reader',
    workspaceId,
    delegationId: 'local-run',
    audience,
    issuedAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
    resourceScope: { executionId: context.executionId },
  }),
}))
vi.mock('@/lib/workflows/custom-blocks/operations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/workflows/custom-blocks/operations')>()),
  getCustomBlockRowsForWorkspace: async () => [],
}))
vi.mock('@/lib/workflows/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/workflows/utils')>()),
  updateWorkflowRunCounts: async () => {},
}))
vi.mock('@/lib/workflows/executor/execution-id-claim', () => ({
  claimExecutionId: async (id: string) => ({ key: id, token: id }),
  hasDurableExecutionOwner: async () => true,
  releaseExecutionIdClaim: async () => {},
}))
vi.mock('@/lib/workflows/executor/human-in-the-loop-manager', () => ({
  PauseResumeManager: { processQueuedResumes: async () => {} },
}))
vi.mock('@/lib/public-shares/share-manager', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/public-shares/share-manager')>()),
  getShareForResource: async () => null,
}))
vi.mock('@/lib/execution/remote-sandbox', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/execution/remote-sandbox')>()),
  executeInSandbox: vi.fn(async () => {
    throw new Error('Remote compute is outside this local proof')
  }),
  executeShellInSandbox: vi.fn(async () => {
    throw new Error('Remote compute is outside this local proof')
  }),
}))
vi.mock('@/lib/execution/payloads/large-value-metadata', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/execution/payloads/large-value-metadata')>()),
  registerLargeValueOwner: async () => true,
  replaceLargeValueReferenceKeysWithClient: async () => {},
}))
vi.mock('@/lib/uploads', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/uploads')>()),
  StorageService: {
    uploadFile: async ({ file, customKey }: { file: Buffer; customKey: string }) => {
      if (!customKey.startsWith(`execution/${workspaceId}/`))
        throw new Error('Unexpected fixture storage scope')
      const path = join(fixture.directory, generateId())
      await writeFile(path, file)
      fixture.storageKeys.set(customKey, path)
      return { key: customKey }
    },
    downloadFile: async ({ key }: { key: string }) => {
      const path = fixture.storageKeys.get(key)
      if (!path) throw new Error('Missing fixture object')
      fixture.storageReads.push(key)
      return readFile(path)
    },
  },
}))
vi.mock('@/lib/billing/core/usage-log', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/billing/core/usage-log')>()),
  recordUsage: async () => {},
}))
vi.mock('@/lib/billing/core/subscription', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/billing/core/subscription')>()),
  getHighestPriorityPersonalSubscription: async () => null,
}))
vi.mock('@/lib/billing/calculations/usage-monitor', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/billing/calculations/usage-monitor')>()),
  checkUsageStatus: async () => ({ limit: 100, percentUsed: 0, currentUsage: 0 }),
}))
vi.mock('@/lib/billing/core/usage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/billing/core/usage')>()),
  maybeSendUsageThresholdEmail: async () => {},
}))
vi.mock('@/lib/billing/calculations/usage-reservation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/billing/calculations/usage-reservation')>()),
  releaseExecutionSlot: async () => {},
}))
vi.mock('@/lib/workspace-events/emitter', () => ({ emitExecutionCompletedEvent: async () => {} }))
vi.mock('@/lib/core/telemetry', () => ({
  PlatformEvents: { workflowExecuted: () => {} },
  createOTelSpansForWorkflowExecution: () => {},
}))

const workspaceId = 'saved-run-workspace'
const workflowId = 'saved-run-workflow'
const blockId = '40109ba4-ac03-4a92-b044-c97f703718bf'
const now = new Date('2026-09-06T12:00:00.000Z')
const ended = new Date(now.getTime() + 1200)
const provenance = {
  version: 1,
  complete: true,
  entries: [],
  scope: { userId: 'run-reader', workspaceId },
} as const

const identity: EmbeddedCliIdentity = {
  endpoint: 'https://sim.test',
  apiKey: 'local-key',
  workspaceId,
  transport: async (url, init) => {
    const request = new NextRequest(new Request(url, init))
    expect(request.headers.get('x-api-key')).toBe('local-key')
    fixture.requests.push(request.nextUrl.pathname)
    const execution = request.nextUrl.pathname.match(/^\/api\/v2\/workflows\/([^/]+)\/execute$/)
    if (execution)
      return executeRoute(request, { params: Promise.resolve({ workflowId: execution[1] }) })
    const run = request.nextUrl.pathname.match(/^\/api\/v2\/workflows\/([^/]+)\/runs\/([^/]+)$/)
    if (run) {
      return runRoute(request, {
        params: Promise.resolve({ workflowId: run[1], runId: run[2] }),
      })
    }
    const log = request.nextUrl.pathname.match(/^\/api\/v2\/logs\/([^/]+)$/)
    if (log) return logRoute(request, { params: Promise.resolve({ runId: log[1] }) })
    throw new Error(`Unexpected saved-run request: ${request.method} ${request.nextUrl.pathname}`)
  },
}

async function seedRun(status: 'completed' | 'failed', executionData: Record<string, unknown>) {
  const runId = generateId()
  const logId = generateId()
  const snapshotId = generateId()
  await db.insert(workflowExecutionSnapshots).values({
    id: snapshotId,
    workflowId,
    stateHash: generateId(),
    stateData: {
      blocks: {
        [blockId]: {
          id: blockId,
          type: 'function',
          name: 'Validate invoice',
          subBlocks: { code: { id: 'code', type: 'code', value: 'return input.amount * 2' } },
        },
      },
      edges: [],
      loops: {},
      parallels: {},
    },
    createdAt: now,
  })
  await db.insert(workflowExecutionLogs).values({
    id: logId,
    executionId: runId,
    workflowId,
    workspaceId,
    stateSnapshotId: snapshotId,
    status,
    level: status === 'failed' ? 'error' : 'info',
    trigger: 'manual',
    startedAt: now,
    endedAt: ended,
    totalDurationMs: 1200,
    costTotal: '0.001',
    files: [],
    createdAt: now,
    executionData: {
      secretProjectionVersion: SECRET_PROJECTION_VERSION,
      resolvedSecretTraceProvenance: provenance,
      billingAttribution: { actorUserId: 'run-reader' },
      ...executionData,
    },
  })
  return { runId, logId }
}

async function readRun(runId: string, ...flags: string[]) {
  return runCli(
    ['workflows', 'runs', 'get', runId, '--workflow', workflowId, ...flags],
    identity,
    null
  )
}

const postExecution = vi.spyOn(LoggingSession.prototype, 'setPostExecutionPromise')
const schemaName = `saved_run_${generateId().replaceAll('-', '')}`
const tables = [
  organization,
  usageLog,
  user,
  workspace,
  workflow,
  folder,
  workflowDeploymentVersion,
  workflowExecutionSnapshots,
  workflowExecutionLogs,
  pausedExecutions,
  resumeQueue,
]

describe.skipIf(!process.env.MSHIP_TEST_DATABASE_URL)(
  'saved-run evidence through the real CLI',
  () => {
    beforeAll(async () => {
      fixture.directory = await mkdtemp(join(tmpdir(), 'mship-run-logs-'))
      await db.execute(sql`CREATE SCHEMA ${sql.identifier(schemaName)}`)
      await db.execute(sql`SET search_path TO ${sql.identifier(schemaName)}`)
      for (const table of tables) {
        const config = getTableConfig(table)
        const columns = config.columns.map((column) => {
          const type = column.enumValues?.length ? 'text' : column.getSQLType()
          return sql`${sql.identifier(column.name)} ${sql.raw(type)}`
        })
        await db.execute(
          sql`CREATE TABLE ${sql.identifier(config.name)} (${sql.join(columns, sql`, `)})`
        )
      }
      await db.execute(
        sql`ALTER TABLE workflow_execution_snapshots ALTER COLUMN created_at SET DEFAULT now()`
      )
      await db.execute(
        sql`ALTER TABLE workflow_execution_logs ALTER COLUMN created_at SET DEFAULT now()`
      )
      await db.execute(
        sql`CREATE UNIQUE INDEX ON workflow_execution_snapshots (workflow_id, state_hash)`
      )
      await db.execute(sql`CREATE UNIQUE INDEX ON workflow_execution_logs (execution_id)`)
      await db.insert(user).values({
        id: 'run-reader',
        name: 'Reader',
        email: 'reader@example.com',
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      })
      await db.insert(workspace).values({
        id: workspaceId,
        name: 'Local run reads',
        ownerId: 'run-reader',
        billedAccountUserId: 'run-reader',
        allowPersonalApiKeys: true,
      })
      await db.insert(workflow).values({
        id: workflowId,
        workspaceId,
        userId: 'run-reader',
        name: 'Current draft name',
        lastSynced: now,
        createdAt: now,
        updatedAt: now,
      })
    })
    afterEach(async () => {
      await Promise.all(postExecution.mock.calls.map(([promise]) => promise))
    })
    afterAll(async () => {
      postExecution.mockRestore()
      try {
        await db.execute(sql`DROP SCHEMA IF EXISTS ${sql.identifier(schemaName)} CASCADE`)
      } finally {
        await fixture.close()
        clearLargeValueCacheForTests()
        if (fixture.directory) await rm(fixture.directory, { recursive: true, force: true })
      }
    })
    beforeEach(() => {
      fixture.permission = 'read'
      fixture.requests.length = 0
      fixture.errors.length = 0
      fixture.storageReads.length = 0
      vi.clearAllMocks()
    })

    it.skipIf(process.env.SIM_HELPERS_SMOKE !== '1').each(['completed', 'failed'] as const)(
      'executes a saved workflow and reads its %s result from externalized log bytes',
      async (expectedStatus) => {
        fixture.permission = 'write'
        const code =
          expectedStatus === 'completed'
            ? 'return <start.amount> * 2;'
            : 'throw new Error("Invoice amount must be a number");'
        const saved = runnableState(code)
        fixture.saved.set(workflowId, structuredClone(saved))
        const result = await runCli(
          ['workflows', 'run', workflowId, '--manual', '--input', JSON.stringify({ amount: 21 })],
          identity,
          null
        )
        expect(result.exitCode, JSON.stringify({ ...result, errors: fixture.errors })).toBe(
          expectedStatus === 'completed' ? 0 : 1
        )
        expect(result.stdout, JSON.stringify({ ...result, errors: fixture.errors })).not.toBe('')
        const run = v2ExecuteWorkflowDataSchema.parse(JSON.parse(result.stdout))
        expect(run.status).toBe(expectedStatus)
        const waited = await runCli(
          ['workflows', 'runs', 'wait', run.runId, '--workflow', workflowId, '--wait-timeout', '5'],
          identity,
          null
        )
        expect(waited.exitCode, JSON.stringify({ ...waited, errors: fixture.errors })).toBe(
          expectedStatus === 'completed' ? 0 : 1
        )
        expect(v2WorkflowRunStatusSchema.parse(JSON.parse(waited.stdout)).status).toBe(
          expectedStatus
        )
        const [row] = await db
          .select()
          .from(workflowExecutionLogs)
          .where(eq(workflowExecutionLogs.executionId, run.runId))
        expect(row?.status, JSON.stringify(fixture.errors)).toBe(expectedStatus)
        const ref = (row.executionData as Record<string, unknown>).traceStoreRef
        if (!isLargeValueRef(ref) || !ref.key)
          throw new Error('Expected an externalized trace, not inline fallback')
        expect(fixture.storageKeys.has(ref.key)).toBe(true)
        clearLargeValueCacheForTests()
        const status = await readRun(
          run.runId,
          '--include-output',
          '--select-output',
          `${blockId}.result`
        )
        expect(status.exitCode, status.stderr).toBe(0)
        const storedRun = v2WorkflowRunStatusSchema.parse(JSON.parse(status.stdout))
        expect(storedRun.status).toBe(expectedStatus)
        if (expectedStatus === 'completed') {
          expect(storedRun.output).toEqual(run.output)
          expect(storedRun.output).toMatchObject({ result: 42 })
          expect(storedRun.blockOutputs).toEqual({ [`${blockId}.result`]: 42 })
        } else {
          expect(storedRun.error?.message).toContain('Invoice amount must be a number')
        }
        expect(fixture.storageReads).toContain(ref.key)
        fixture.storageReads.length = 0
        clearLargeValueCacheForTests()
        const log = await runCli(['logs', 'get', run.runId, '--trace'], identity, null)
        expect(log.exitCode, JSON.stringify({ ...log, errors: fixture.errors })).toBe(0)
        const detail = v2LogDetailSchema.parse(JSON.parse(log.stdout))
        expect(detail.status).toBe(expectedStatus)
        expect(detail.workflowState).toMatchObject({
          blocks: { [blockId]: { subBlocks: { code: { value: code } } } },
        })
        expect(detail.executedByEmail).toBe('reader@example.com')
        expect(fixture.storageReads).toContain(ref.key)
        if (expectedStatus === 'failed') {
          const pending = [...detail.traceSpans]
          const failures = []
          while (pending.length > 0) {
            const span = pending.shift()
            if (!span) break
            pending.push(...(span.children ?? []))
            if (span.blockId === blockId && span.status === 'error') failures.push(span)
          }
          expect(failures).toHaveLength(1)
          expect(failures[0]).toMatchObject({
            name: 'Validate invoice',
            output: { error: expect.stringContaining('Invoice amount must be a number') },
          })
        } else {
          expect(detail.workflowInput).toEqual({ amount: 21 })
          expect(detail.finalOutput).toEqual(run.output)
        }
        expect(fixture.saved.get(workflowId)).toEqual(saved)
        expect(executeInSandbox).not.toHaveBeenCalled()
        expect(executeShellInSandbox).not.toHaveBeenCalled()
      },
      30_000
    )

    it('reads authoritative selected outputs independently of diagnostic previews', async () => {
      const { runId, logId } = await seedRun('completed', {
        finalOutput: { amount: 42, source: 'invoice.csv' },
        executionState: {
          blockStates: { [blockId]: { output: { amount: 42, source: 'invoice.csv' } } },
        },
        traceSpans: [
          {
            id: 'preview',
            name: 'Validate invoice',
            type: 'function',
            blockId,
            output: { amount: '[preview]' },
          },
        ],
      })
      const result = await readRun(
        runId,
        '--include-output',
        '--select-output',
        `${blockId}.amount`
      )
      expect(
        result.exitCode,
        JSON.stringify({ stderr: result.stderr, errors: fixture.errors })
      ).toBe(0)
      const data = v2WorkflowRunStatusSchema.parse(JSON.parse(result.stdout))
      expect(data).toMatchObject({
        runId,
        workflowId,
        status: 'completed',
        durationMs: 1200,
        output: { amount: 42, source: 'invoice.csv' },
        blockOutputs: { [`${blockId}.amount`]: 42 },
      })
      expect(data.runId).not.toBe(logId)
      expect(result.stdout).not.toContain('executionState')
      expect(result.stdout).not.toContain('resolvedSecretTraceProvenance')
      expect(fixture.requests).toEqual([`/api/v2/workflows/${workflowId}/runs/${runId}`])
    })

    it('keeps the nested failing block, resolved input and recorded snapshot available for diagnosis', async () => {
      const { runId } = await seedRun('failed', {
        error: { message: 'Invoice amount must be a number' },
        workflowInput: { amount: 'forty-two', source: 'invoice.csv' },
        traceSpans: [
          {
            id: 'root',
            name: 'Invoice run',
            type: 'workflow',
            status: 'error',
            children: [
              {
                id: 'validate',
                name: 'Validate invoice',
                type: 'function',
                blockId,
                status: 'error',
                startTime: now.toISOString(),
                endTime: ended.toISOString(),
                duration: 1200,
                input: { amount: 'forty-two' },
                output: { error: 'Invoice amount must be a number' },
              },
            ],
          },
        ],
      })
      const status = await readRun(runId)
      expect(
        status.exitCode,
        JSON.stringify({ stderr: status.stderr, errors: fixture.errors })
      ).toBe(0)
      expect(v2WorkflowRunStatusSchema.parse(JSON.parse(status.stdout))).toMatchObject({
        status: 'failed',
        error: { message: 'Invoice amount must be a number' },
      })
      const result = await runCli(['logs', 'get', runId, '--trace'], identity, null)
      expect(
        result.exitCode,
        JSON.stringify({ stderr: result.stderr, errors: fixture.errors })
      ).toBe(0)
      const data = v2LogDetailSchema.parse(JSON.parse(result.stdout))
      expect(data).toMatchObject({
        runId,
        workflowId,
        executedByEmail: 'reader@example.com',
        workflowInput: { amount: 'forty-two', source: 'invoice.csv' },
        workflow: { name: 'Current draft name', folderPath: '/' },
        workflowState: {
          blocks: {
            [blockId]: {
              name: 'Validate invoice',
              subBlocks: { code: { value: 'return input.amount * 2' } },
            },
          },
        },
      })
      expect(data.traceSpans[0]?.children?.[0]).toMatchObject({
        blockId,
        status: 'error',
        durationMs: 1200,
        input: { amount: 'forty-two' },
        output: { error: 'Invoice amount must be a number' },
      })
    })

    it('checks current access again before returning previously readable run evidence', async () => {
      const { runId } = await seedRun('completed', {
        finalOutput: { value: 'private-invoice-data' },
      })
      const readable = await readRun(runId, '--include-output')
      expect(readable.exitCode, readable.stderr).toBe(0)
      expect(readable.stdout).toContain('private-invoice-data')
      fixture.permission = null
      for (const argv of [
        ['workflows', 'runs', 'get', runId, '--workflow', workflowId, '--include-output'],
        ['logs', 'get', runId, '--trace'],
      ]) {
        const result = await runCli(argv, identity, null)
        expect(result.exitCode).not.toBe(0)
        expect(result.stdout).not.toContain('private-invoice-data')
        expect(result.stderr).not.toContain('private-invoice-data')
        expect(result.stderr).toContain('NOT_FOUND')
      }
    })

    it('rejects a real run ID asserted against another workflow', async () => {
      const { runId } = await seedRun('completed', {
        finalOutput: { value: 'private-invoice-data' },
      })
      const result = await runCli(
        ['workflows', 'runs', 'get', runId, '--workflow', 'another-workflow', '--include-output'],
        identity,
        null
      )
      expect(result.exitCode).not.toBe(0)
      expect(result.stdout).not.toContain('private-invoice-data')
      expect(result.stderr).toMatch(/not found/i)
    })

    it('refuses unavailable raw outputs instead of returning diagnostic previews as data', async () => {
      const { runId } = await seedRun('completed', {
        executionDataTruncated: true,
        traceSpans: [
          {
            id: 'preview',
            name: 'Validate invoice',
            type: 'function',
            blockId,
            output: { amount: '[preview]' },
          },
        ],
      })
      const result = await readRun(runId, '--select-output', `${blockId}.amount`)
      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toContain('Raw block outputs are unavailable')
      expect(result.stdout).not.toContain('[preview]')
    })

    it('does not substitute another run when a log row has been removed', async () => {
      const { runId } = await seedRun('completed', {
        finalOutput: { value: 'private-invoice-data' },
      })
      await db.delete(workflowExecutionLogs).where(eq(workflowExecutionLogs.executionId, runId))
      for (const result of [
        await readRun(runId),
        await runCli(['logs', 'get', runId], identity, null),
      ]) {
        expect(result.exitCode).not.toBe(0)
        expect(result.stderr).toContain('NOT_FOUND')
      }
    })
  }
)

function runnableState(code: string) {
  const blocks: Record<string, BlockState> = {
    start: {
      id: 'start',
      type: 'starter',
      name: 'Start',
      position: { x: 0, y: 0 },
      enabled: true,
      subBlocks: {
        inputFormat: {
          id: 'inputFormat',
          type: 'input-format',
          value: JSON.stringify([{ name: 'amount', type: 'number' }]),
        },
      },
      outputs: { amount: { type: 'number' } },
    },
    [blockId]: {
      id: blockId,
      type: 'function',
      name: 'Validate invoice',
      position: { x: 0, y: 100 },
      enabled: true,
      subBlocks: {
        code: { id: 'code', type: 'code', value: code },
        language: { id: 'language', type: 'dropdown', value: 'javascript' },
      },
      outputs: { result: { type: 'json' } },
    },
  }
  return {
    blocks,
    edges: [{ id: 'start-validate', source: 'start', target: blockId }],
    loops: {},
    parallels: {},
  }
}
