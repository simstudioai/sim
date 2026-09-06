/**
 * @vitest-environment node
 *
 * Opt in with MSHIP_TEST_DATABASE_URL pointing to a local mship_audit_* database.
 * Real CLI, routes, application scope/authorization, SQL joins and display projection.
 * Rows are seeded; authentication, membership and billing are fixtures. The isolated
 * schema derives columns from production but does not prove migrations or constraints.
 */
import { db } from '@sim/db'
import {
  folder,
  pausedExecutions,
  resumeQueue,
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
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { v2LogDetailSchema } from '@/lib/api/contracts/v2/logs'
import { v2WorkflowRunStatusSchema } from '@/lib/api/contracts/v2/workflows'
import { SECRET_PROJECTION_VERSION } from '@/lib/logs/execution/trace-store'
import { runCli } from '@/lib/mothership/agent-cli/run-cli'
import { GET as logRoute } from '@/app/api/v2/logs/[runId]/route'
import { GET as runRoute } from '@/app/api/v2/workflows/[workflowId]/runs/[runId]/route'

const fixture = vi.hoisted(() => ({
  close: async () => {},
  permission: 'read' as PermissionType | null,
  requests: [] as string[],
  errors: [] as unknown[],
}))
vi.mock('@sim/logger', async () => {
  const { loggerMock, createMockLogger } = await import('@sim/testing')
  return {
    ...loggerMock,
    createLogger: () => ({
      ...createMockLogger(),
      error: (...args: unknown[]) => fixture.errors.push(args),
    }),
  }
})
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
  return { db: database, dbReplica: database, dbFor: () => database }
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

const schemaName = `saved_run_${generateId().replaceAll('-', '')}`
const tables = [
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
    afterAll(async () => {
      try {
        await db.execute(sql`DROP SCHEMA IF EXISTS ${sql.identifier(schemaName)} CASCADE`)
      } finally {
        await fixture.close()
      }
    })
    beforeEach(() => {
      fixture.permission = 'read'
      fixture.requests.length = 0
      fixture.errors.length = 0
    })

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
