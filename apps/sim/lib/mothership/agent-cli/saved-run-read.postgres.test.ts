/**
 * @vitest-environment node
 *
 * Opt in with MSHIP_TEST_DATABASE_URL pointing to a local mship_audit_* database.
 * SIM_HELPERS_SMOKE=1 also runs the actual service/DAG/Function runtime and log writer.
 * MSHIP_WORKER_ROOT additionally runs the real controller with a local scripted worker.
 * CLI, routes, canonical scope, application authorization, SQL and display projection
 * are real. Execution traces and workspace objects live in local files; cache clearing
 * forces physical reads. D4/B1 cases run the companion's canonical oracles; B1 also
 * stores and edits actual normalized graphs. Realtime publication is a fixture.
 * Authentication, delegation, membership, saved drafts, workflow admission, billing, ownership
 * and external effects are fixtures. Seeded cases also bypass execution/log writing.
 * Isolated columns plus required defaults/indexes do not prove migrations or all constraints.
 */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createReadStream } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import type { DelegatedPrincipal } from '@sim/auth/principal'
import { db } from '@sim/db'
import {
  auditLog,
  copilotAsyncToolCalls,
  copilotChats,
  copilotMessages,
  copilotRequestStops,
  copilotRuns,
  folder,
  organization,
  pausedExecutions,
  publicShare,
  resumeQueue,
  tableJobs,
  tableRowExecutions,
  usageLog,
  user,
  userTableDefinitions,
  userTableRowSecretProvenance,
  userTableRows,
  workflow,
  workflowBlocks,
  workflowDeploymentVersion,
  workflowEdges,
  workflowExecutionLogs,
  workflowExecutionSnapshots,
  workflowSubflows,
  workspace,
  workspaceFileSecretProvenance,
  workspaceFiles,
} from '@sim/db/schema'
import type { PermissionType } from '@sim/platform-authz/workspace'
import { authMockFns } from '@sim/testing'
import { generateId } from '@sim/utils/id'
import { eq, is, SQL, sql } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { NextRequest } from 'next/server'
import { PDFDocument } from 'pdf-lib'
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
import { executeAgentCliRequest } from '@/lib/mothership/agent-cli'
import { runCli } from '@/lib/mothership/agent-cli/run-cli'
import { resolveCopilotWorkspaceFileReference } from '@/lib/mothership/application/execute-file-use-case'
import {
  areStreamToolExecutionsSettled,
  claimSimToolExecution,
  claimWorkflowToolExecution,
  closeStreamToolAdmission,
  completeAsyncToolCall,
  detachAsyncToolCall,
  getUnsettledClientWorkflowExecutions,
  prepareWorkbenchAccess,
  settleSimToolExecution,
} from '@/lib/mothership/async-runs/repository'
import { loadCopilotChatMessages } from '@/lib/mothership/chat/lifecycle'
import { appendCopilotChatMessages } from '@/lib/mothership/chat/messages-store'
import { prepareInboxAttachments } from '@/lib/mothership/inbox/attachments'
import { runCopilotLifecycle } from '@/lib/mothership/request/lifecycle/run'
import { isToolCallStreamEvent } from '@/lib/mothership/request/session'
import { ensureHandlersRegistered } from '@/lib/mothership/tool-executor/register-handlers'
import { resolveInputFiles } from '@/lib/mothership/tools/handlers/function-execute'
import { chatSandboxSessionKey } from '@/lib/mothership/tools/sandbox-session-key'
import { replaceWorkflowNormalizedState } from '@/lib/workflows/persistence/replace-normalized-state'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { readWorkspaceFileText } from '@/lib/workspace-files/application/read-workspace-file-text'
import { POST as stopChatRoute } from '@/app/api/mothership/chat/stop/route'
import { POST as forkChatRoute } from '@/app/api/mothership/chats/[chatId]/fork/route'
import { GET as fileRoute } from '@/app/api/v2/files/[fileId]/route'
import { GET as fileTextRoute } from '@/app/api/v2/files/[fileId]/text/route'
import { GET as filesRoute } from '@/app/api/v2/files/route'
import { GET as logRoute } from '@/app/api/v2/logs/[runId]/route'
import { GET as logsRoute } from '@/app/api/v2/logs/route'
import {
  POST as createRowsRoute,
  GET as tableRowsRoute,
} from '@/app/api/v2/tables/[tableId]/rows/route'
import { POST as executeRoute } from '@/app/api/v2/workflows/[workflowId]/execute/route'
import { POST as workflowOperationsRoute } from '@/app/api/v2/workflows/[workflowId]/operations/route'
import { GET as runRoute } from '@/app/api/v2/workflows/[workflowId]/runs/[runId]/route'
import { GET as workflowStateRoute } from '@/app/api/v2/workflows/[workflowId]/state/route'
import { GET as workflowsRoute } from '@/app/api/v2/workflows/route'
import { toRawPersistedContentBlock } from '@/app/workspace/[workspaceId]/home/hooks/message-reconcile'
import type { ContentBlock as DisplayContentBlock } from '@/app/workspace/[workspaceId]/home/types'
import { getLatestBlock } from '@/blocks/registry'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import type { BlockState, WorkflowState } from '@/stores/workflows/workflow/types'

const fixture = vi.hoisted(() => ({
  schemaName: `saved_run_${process.pid}_${Date.now()}`,
  close: async () => {},
  workerUrl: '',
  permission: 'read' as PermissionType | null,
  requests: [] as string[],
  errors: [] as unknown[],
  saved: new Map<string, ReturnType<typeof runnableState>>(),
  physicalWorkflows: new Set<string>(),
  directory: '',
  storageReads: [] as string[],
  storageKeys: new Map<string, string>(),
  inboxBytes: new Map<string, Buffer>(),
}))
vi.mock('@/lib/mothership/request/http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/mothership/request/http')>()),
  authenticateCopilotRequestSessionOnly: async () => ({
    userId: 'run-reader',
    isAuthenticated: true,
  }),
}))
vi.mock('@/lib/workspaces/permissions/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/workspaces/permissions/utils')>()),
  assertActiveWorkspaceAccess: async () => {
    if (!fixture.permission) throw new Error('Workspace access denied')
  },
}))
vi.mock('@/lib/mothership/chat-status', () => ({ chatPubSub: null }))
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: () => {} }))
vi.mock('@/lib/mothership/inbox/agentmail-client', () => ({
  getAttachment: async (_inbox: string, _message: string, id: string) => {
    const bytes = fixture.inboxBytes.get(id)
    if (!bytes) throw new Error('Missing local inbox attachment')
    return bytes
  },
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
  const client = postgres(url, {
    max: 4,
    connection: { search_path: fixture.schemaName },
    onnotice: () => {},
  })
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
vi.mock('@/lib/core/utils/urls', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/core/utils/urls')>()),
  getInternalApiBaseUrl: () => 'https://sim.test',
}))
vi.mock('@/lib/mothership/server/agent-url', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/mothership/server/agent-url')>()),
  getMothershipBaseURL: () => fixture.workerUrl,
}))
vi.mock('@/lib/mothership/chat/delegation', () => ({
  mintDelegationToken: async () => 'local-key',
}))
vi.mock('@/lib/mothership/request/enterprise-byok', () => ({
  resolveEnterpriseByokKey: async () => null,
}))
vi.mock('@/lib/logs/cost-ledger', () => ({ buildCostLedger: async () => null }))
vi.mock('@/lib/core/async-jobs', () => ({
  getJobQueue: async () => ({ getJob: async () => null }),
}))

vi.mock('@/lib/workflows/persistence/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/workflows/persistence/utils')>()
  return {
    ...actual,
    loadWorkflowFromNormalizedTables: async (id: string) =>
      fixture.physicalWorkflows.has(id)
        ? actual.loadWorkflowFromNormalizedTables(id)
        : structuredClone(fixture.saved.get(id) ?? null),
  }
})
vi.mock('@/lib/realtime/notify', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/realtime/notify')>()),
  notifyWorkflowUpdated: async () => {},
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
    resourceScope,
  }: CreateExecutorPrincipalFromExecutionContextInput): Promise<DelegatedPrincipal> => ({
    kind: 'delegated',
    serviceId: 'executor',
    subjectUserId: 'run-reader',
    workspaceId,
    delegationId: 'local-run',
    audience,
    issuedAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
    resourceScope: { executionId: context.executionId, ...resourceScope },
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
vi.mock('@/lib/uploads/core/storage-service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/uploads/core/storage-service')>()),
  uploadFile: async ({
    file,
    customKey,
    metadata,
    context,
    fileName,
    contentType,
    persistMetadata = true,
  }: Parameters<typeof import('@/lib/uploads/core/storage-service').uploadFile>[0]) => {
    if (!customKey) throw new Error('Expected a fixture storage key')
    const path = join(fixture.directory, generateId())
    await writeFile(path, file)
    fixture.storageKeys.set(customKey, path)
    if (persistMetadata && metadata) {
      const { insertFileMetadata } = await import('@/lib/uploads/server/metadata')
      await insertFileMetadata({
        key: customKey,
        userId: metadata.userId,
        workspaceId: metadata.workspaceId,
        context,
        originalName: metadata.originalName ?? fileName,
        contentType,
        size: file.length,
      })
    }
    return { key: customKey }
  },
  deleteFile: async ({ key }: { key: string }) => {
    const path = fixture.storageKeys.get(key)
    if (path) await rm(path, { force: true })
    fixture.storageKeys.delete(key)
  },
  downloadFile: async ({ key }: { key: string }) => {
    const path = fixture.storageKeys.get(key)
    if (!path) throw new Error('Missing fixture workspace object')
    fixture.storageReads.push(key)
    return readFile(path)
  },
  downloadFileStream: async ({ key }: { key: string }) => {
    const path = fixture.storageKeys.get(key)
    if (!path) throw new Error('Missing fixture workspace stream')
    fixture.storageReads.push(key)
    return createReadStream(path)
  },
}))
vi.mock('@/lib/billing/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/billing/storage')>()),
  resolveStorageBillingContext: async () => ({ billedAccountUserId: 'run-reader' }),
  incrementStorageUsageForBillingContextInTx: async () => 0,
  maybeNotifyStorageLimitForBillingContext: async () => {},
}))
vi.mock('@/lib/realtime/notify', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/realtime/notify')>()),
  mergeEditIntoLiveFileDoc: async () => {},
}))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-storage-cleanup-outbox', () => ({
  enqueueWorkspaceFileStorageCleanup: async () => {},
  processWorkspaceFileStorageCleanupNow: async () => {},
}))
vi.mock('@/lib/table/trigger', () => ({ fireTableTrigger: async () => {} }))
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

const workspaceId = '2afda21d-d08a-46bb-aaf9-7a4a6c741dbd'

function createSignal(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => {}
  const promise = new Promise<void>((notify) => {
    resolve = notify
  })
  return { promise, resolve }
}

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

const identity = {
  endpoint: 'https://sim.test',
  apiKey: 'local-key',
  workspaceId,
  transport: async (url, init) => {
    const request = new NextRequest(new Request(url, init))
    expect(request.headers.get('x-api-key')).toBe('local-key')
    fixture.requests.push(request.nextUrl.pathname)
    if (request.nextUrl.pathname === '/api/v2/workflows') return workflowsRoute(request)
    if (request.nextUrl.pathname === '/api/v2/files') return filesRoute(request)
    if (request.nextUrl.pathname === '/api/v2/logs') return logsRoute(request)
    const file = request.nextUrl.pathname.match(/^\/api\/v2\/files\/([^/]+)$/)
    if (file) return fileRoute(request, { params: Promise.resolve({ fileId: file[1] }) })
    const rows = request.nextUrl.pathname.match(/^\/api\/v2\/tables\/([^/]+)\/rows$/)
    if (rows)
      return (request.method === 'POST' ? createRowsRoute : tableRowsRoute)(request, {
        params: Promise.resolve({ tableId: rows[1] }),
      })
    const graph = request.nextUrl.pathname.match(
      /^\/api\/v2\/workflows\/([^/]+)\/(state|operations)$/
    )
    if (graph)
      return (graph[2] === 'state' ? workflowStateRoute : workflowOperationsRoute)(request, {
        params: Promise.resolve({ workflowId: graph[1] }),
      })
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
} satisfies EmbeddedCliIdentity

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
const schemaName = fixture.schemaName
const tables = [
  auditLog,
  copilotChats,
  copilotMessages,
  copilotRuns,
  copilotRequestStops,
  copilotAsyncToolCalls,
  organization,
  usageLog,
  user,
  workspace,
  workflow,
  workflowBlocks,
  workflowEdges,
  workflowSubflows,
  folder,
  workflowDeploymentVersion,
  workflowExecutionSnapshots,
  workflowExecutionLogs,
  pausedExecutions,
  resumeQueue,
  tableJobs,
  tableRowExecutions,
  userTableDefinitions,
  userTableRowSecretProvenance,
  userTableRows,
  workspaceFiles,
  workspaceFileSecretProvenance,
  publicShare,
]

describe.skipIf(!process.env.MSHIP_TEST_DATABASE_URL)(
  'saved-run evidence through the real CLI',
  () => {
    beforeAll(async () => {
      fixture.directory = await mkdtemp(join(tmpdir(), 'mship-run-logs-'))
      await db.execute(sql`CREATE SCHEMA ${sql.identifier(schemaName)}`)
      for (const table of tables) {
        const config = getTableConfig(table)
        const columns = config.columns.map((column) => {
          const type = column.enumValues?.length ? 'text' : column.getSQLType()
          const defaultValue =
            column.default === undefined
              ? sql``
              : sql` DEFAULT ${is(column.default, SQL) ? column.default : sql.param(column.default, column)}`.inlineParams()
          return sql`${sql.identifier(column.name)} ${sql.raw(type)}${defaultValue}`
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
      for (const table of [copilotRuns, copilotAsyncToolCalls]) {
        const name = sql.identifier(getTableConfig(table).name)
        await db.execute(sql`ALTER TABLE ${name} ALTER COLUMN id SET DEFAULT gen_random_uuid()`)
        await db.execute(sql`ALTER TABLE ${name} ALTER COLUMN created_at SET DEFAULT now()`)
        await db.execute(sql`ALTER TABLE ${name} ALTER COLUMN updated_at SET DEFAULT now()`)
      }
      await db.execute(sql`ALTER TABLE copilot_runs ALTER COLUMN started_at SET DEFAULT now()`)
      await db.execute(sql`CREATE UNIQUE INDEX ON copilot_runs (stream_id)`)
      await db.execute(sql`CREATE UNIQUE INDEX ON copilot_messages (chat_id, message_id)`)
      await db.execute(sql`CREATE UNIQUE INDEX ON copilot_async_tool_calls (tool_call_id)`)
      for (const table of [workflowBlocks, workflowEdges, workflowSubflows]) {
        await db.execute(
          sql`CREATE UNIQUE INDEX ON ${sql.identifier(getTableConfig(table).name)} (id)`
        )
      }
      await db.execute(sql`CREATE UNIQUE INDEX ON user_table_rows (id)`)
      await db.execute(sql`CREATE UNIQUE INDEX ON user_table_row_secret_provenance (row_id)`)
      await db.execute(sql`CREATE UNIQUE INDEX ON workspace_file_secret_provenance (file_id)`)
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

    it.each(['active', 'complete', 'cancelled', 'error'] as const)(
      'refuses a late workflow pickup after the parent run closes: %s',
      async (status) => {
        const runId = generateId()
        const streamId = generateId()
        const toolCallId = generateId()
        await db.insert(copilotRuns).values({
          id: runId,
          streamId,
          chatId: generateId(),
          workspaceId,
          userId: 'run-reader',
          executionId: generateId(),
          status,
          toolExecutionVersion: 2,
        })
        await db.insert(copilotAsyncToolCalls).values({
          runId,
          toolCallId,
          toolName: 'run_workflow',
          status: 'running',
          args: { workflowId },
        })
        if (status === 'active') {
          expect(await closeStreamToolAdmission(streamId, 'run-reader')).toBe(true)
        }
        expect(await claimWorkflowToolExecution(toolCallId, generateId(), 'client')).toBeNull()
        const [tool] = await db
          .select()
          .from(copilotAsyncToolCalls)
          .where(eq(copilotAsyncToolCalls.toolCallId, toolCallId))
        expect(tool.claimedBy).toBeNull()
      }
    )

    it('serializes workflow pickup with Stop on another physical database connection', async () => {
      const runId = generateId()
      const toolCallId = generateId()
      await db.insert(copilotRuns).values({
        id: runId,
        streamId: generateId(),
        chatId: generateId(),
        workspaceId,
        userId: 'run-reader',
        executionId: generateId(),
        status: 'active',
        toolExecutionVersion: 2,
      })
      await db.insert(copilotAsyncToolCalls).values({
        runId,
        toolCallId,
        toolName: 'run_workflow',
        status: 'running',
        args: { workflowId },
      })
      let resolveHeld: (pid: number) => void = () => {}
      let rejectHeld: (error: unknown) => void = () => {}
      const held = new Promise<number>((resolve, reject) => {
        resolveHeld = resolve
        rejectHeld = reject
      })
      let release: () => void = () => {}
      const released = new Promise<void>((resolve) => {
        release = resolve
      })
      const closing = db.transaction(async (tx) => {
        await tx
          .update(copilotRuns)
          .set({ toolAdmissionClosedAt: new Date() })
          .where(eq(copilotRuns.id, runId))
        const [connection] = await tx.execute(sql`SELECT pg_backend_pid() AS pid`)
        if (typeof connection.pid !== 'number')
          throw new Error('Missing database connection identity')
        resolveHeld(connection.pid)
        await released
      })
      closing.catch(rejectHeld)
      const pid = await held
      const pickup = claimWorkflowToolExecution(toolCallId, generateId(), 'client')
      try {
        await vi.waitFor(
          async () => {
            const [observation] = await db.execute(sql`
            SELECT EXISTS (
              SELECT 1 FROM pg_stat_activity
              WHERE datname = current_database()
                AND ${pid} = ANY(pg_blocking_pids(pid))
            ) AS blocked`)
            expect(observation.blocked).toBe(true)
          },
          { timeout: 3000, interval: 10 }
        )
        release()
        await closing
        expect(await pickup).toBeNull()
      } finally {
        release()
        await closing
        await pickup
      }
    })

    it('admits one eligible workflow pickup and preserves its winning execution identity', async () => {
      const runId = generateId()
      const toolCallId = generateId()
      await db.insert(copilotRuns).values({
        id: runId,
        streamId: generateId(),
        chatId: generateId(),
        workspaceId,
        userId: 'run-reader',
        executionId: generateId(),
        status: 'active',
        toolExecutionVersion: 2,
      })
      await db.insert(copilotAsyncToolCalls).values({
        runId,
        toolCallId,
        toolName: 'run_workflow',
        status: 'running',
        args: { workflowId },
      })
      const claims = await Promise.all(
        Array.from({ length: 4 }, (_, index) =>
          claimWorkflowToolExecution(toolCallId, generateId(), index % 2 === 0 ? 'client' : 'sim')
        )
      )
      const winners = claims.filter((claim) => claim !== null)
      expect(winners).toHaveLength(1)
      const [tool] = await db
        .select()
        .from(copilotAsyncToolCalls)
        .where(eq(copilotAsyncToolCalls.toolCallId, toolCallId))
      expect(tool.claimedBy).toBe(winners[0]?.claimedBy)
      expect(tool.claimedBy).toMatch(/^workflow:/)
    })

    it.each(['completed', 'cancelled', 'delivered'] as const)(
      'retains client execution ownership after a %s tool result until its handler settles',
      async (status) => {
        const runId = generateId()
        const streamId = generateId()
        const toolCallId = generateId()
        const executionId = generateId()
        await db.insert(copilotRuns).values({
          id: runId,
          streamId,
          chatId: generateId(),
          workspaceId,
          userId: 'run-reader',
          executionId: generateId(),
          status: 'active',
          toolExecutionVersion: 2,
        })
        await db.insert(copilotAsyncToolCalls).values({
          runId,
          toolCallId,
          toolName: 'run_workflow',
          status: 'running',
          args: { workflowId },
        })
        expect(await claimWorkflowToolExecution(toolCallId, executionId, 'client')).not.toBeNull()
        expect(await claimSimToolExecution({ runId, toolCallId, userId: 'run-reader' })).toEqual({
          outcome: 'existing',
        })
        if (status === 'delivered') {
          await detachAsyncToolCall(toolCallId)
        } else {
          await completeAsyncToolCall({
            toolCallId,
            status,
            result: { executionId: 'untrusted-result-id' },
          })
        }
        expect(await closeStreamToolAdmission(streamId, 'run-reader')).toBe(true)
        expect(await areStreamToolExecutionsSettled(streamId, 'run-reader')).toBe(false)
        expect(await getUnsettledClientWorkflowExecutions(streamId, 'run-reader')).toEqual([
          executionId,
        ])
        expect(await getUnsettledClientWorkflowExecutions(streamId, 'another-user')).toEqual([])
        expect(await getUnsettledClientWorkflowExecutions(generateId(), 'run-reader')).toEqual([])
        expect(await claimWorkflowToolExecution(toolCallId, generateId(), 'client')).toBeNull()
        await settleSimToolExecution(toolCallId)
        expect(await areStreamToolExecutionsSettled(streamId, 'run-reader')).toBe(true)
        expect(await getUnsettledClientWorkflowExecutions(streamId, 'run-reader')).toEqual([])
      }
    )

    it('keeps prior browser workflow ownership separate from this chat workbench', async () => {
      const chatId = generateId()
      const priorRunId = generateId()
      const priorToolId = generateId()
      const runId = generateId()
      const toolCallId = generateId()
      const streamId = generateId()
      await db.insert(copilotRuns).values([
        {
          id: priorRunId,
          streamId,
          chatId,
          workspaceId,
          userId: 'run-reader',
          executionId: generateId(),
          status: 'active',
          toolExecutionVersion: 2,
          startedAt: sql`now() - interval '1 second'`,
        },
        {
          id: runId,
          streamId: generateId(),
          chatId,
          workspaceId,
          userId: 'run-reader',
          executionId: generateId(),
          status: 'active',
          toolExecutionVersion: 2,
        },
      ])
      await db.insert(copilotAsyncToolCalls).values([
        {
          runId: priorRunId,
          toolCallId: priorToolId,
          toolName: 'run_workflow',
          status: 'running',
          args: { workflowId },
        },
        { runId, toolCallId, toolName: 'run_code', status: 'running' },
      ])
      await claimWorkflowToolExecution(priorToolId, generateId(), 'client')
      await claimSimToolExecution({ runId, toolCallId, userId: 'run-reader' })
      expect(
        await prepareWorkbenchAccess({
          runId,
          toolCallId,
          userId: 'run-reader',
          sessionKey: chatSandboxSessionKey(chatId),
        })
      ).toEqual({ handlersPending: false, processes: [] })
      expect(await areStreamToolExecutionsSettled(streamId, 'run-reader')).toBe(false)
      await settleSimToolExecution(priorToolId)
      await settleSimToolExecution(toolCallId)
    })

    it('lets a server pickup acquire its handler without recording a browser execution', async () => {
      const runId = generateId()
      const streamId = generateId()
      const toolCallId = generateId()
      await db.insert(copilotRuns).values({
        id: runId,
        streamId,
        chatId: generateId(),
        workspaceId,
        userId: 'run-reader',
        executionId: generateId(),
        status: 'active',
        toolExecutionVersion: 2,
      })
      await db.insert(copilotAsyncToolCalls).values({
        runId,
        toolCallId,
        toolName: 'run_workflow',
        status: 'running',
        args: { workflowId },
      })
      expect(await claimWorkflowToolExecution(toolCallId, generateId(), 'sim')).not.toBeNull()
      expect(await claimSimToolExecution({ runId, toolCallId, userId: 'run-reader' })).toEqual({
        outcome: 'claimed',
      })
      await closeStreamToolAdmission(streamId, 'run-reader')
      expect(await getUnsettledClientWorkflowExecutions(streamId, 'run-reader')).toEqual([])
      expect(await areStreamToolExecutionsSettled(streamId, 'run-reader')).toBe(false)
      await settleSimToolExecution(toolCallId)
      expect(await areStreamToolExecutionsSettled(streamId, 'run-reader')).toBe(true)
    })

    it('retains Stop snapshot metadata through the HTTP contract and physical chat history', async () => {
      const chatId = generateId()
      const streamId = generateId()
      const taskId = generateId()
      const watchedExecutionId = generateId()
      await db.insert(copilotChats).values({
        id: chatId,
        userId: 'run-reader',
        workspaceId,
        type: 'mothership',
        title: 'Stopped watch',
        conversationId: streamId,
      })
      await appendCopilotChatMessages(chatId, [
        {
          id: streamId,
          role: 'user',
          content: 'Watch this run',
          timestamp: new Date().toISOString(),
        },
      ])
      const task = {
        taskId,
        kind: 'workflow_run' as const,
        status: 'pending' as const,
        target: { workflowId, executionId: watchedExecutionId },
        note: 'Report the invoice result',
      }
      const blocks: DisplayContentBlock[] = [
        { type: 'task', task },
        { type: 'plan', planItems: [{ step: 'Verify the invoice result', status: 'active' }] },
        {
          type: 'subagent_end',
          subagentName: 'Inspect invoices',
          error: 'Stopped during inspection',
          spanId: 'inspection',
          parentSpanId: 'main',
          parentToolCallId: 'inspect-call',
        },
        {
          type: 'subagent_text',
          subagent: 'Inspect invoices',
          content: 'Found the invoice run.',
          spanId: 'inspection',
          parentSpanId: 'main',
          parentToolCallId: 'inspect-call',
        },
      ]
      authMockFns.mockGetSession.mockResolvedValueOnce({ user: { id: 'run-reader' } })
      const response = await stopChatRoute(
        new NextRequest('https://sim.test/api/mothership/chat/stop', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            chatId,
            streamId,
            content: '',
            contentBlocks: blocks.map(toRawPersistedContentBlock),
          }),
        }),
        undefined
      )
      expect(response.status).toBe(200)
      const saved = await loadCopilotChatMessages(chatId)
      expect(saved).toHaveLength(2)
      expect(saved[1].contentBlocks).toEqual(
        expect.arrayContaining([
          { type: 'task', task },
          { type: 'plan', planItems: [{ step: 'Verify the invoice result', status: 'active' }] },
          {
            type: 'span',
            kind: 'subagent',
            lifecycle: 'end',
            name: 'Inspect invoices',
            error: 'Stopped during inspection',
            spanId: 'inspection',
            parentSpanId: 'main',
            parentToolCallId: 'inspect-call',
          },
          {
            type: 'text',
            lane: 'subagent',
            channel: 'assistant',
            agent: 'Inspect invoices',
            content: 'Found the invoice run.',
            spanId: 'inspection',
            parentSpanId: 'main',
            parentToolCallId: 'inspect-call',
          },
          { type: 'complete', status: 'cancelled' },
        ])
      )
      const [chat] = await db
        .select({ streamId: copilotChats.conversationId })
        .from(copilotChats)
        .where(eq(copilotChats.id, chatId))
      expect(chat.streamId).toBeNull()
    })

    it('reads actual inbox attachment bytes after chat binding', async () => {
      const chatId = generateId()
      const attachmentId = generateId()
      const filename = `inbox ${attachmentId}.csv`
      const bytes = Buffer.from('account,total\nalpha,17\nbeta,23\n')
      fixture.inboxBytes.set(attachmentId, bytes)
      try {
        const prepared = await prepareInboxAttachments({
          attachments: [
            { attachment_id: attachmentId, filename, content_type: 'text/csv', size: bytes.length },
          ],
          inboxProviderId: 'local-inbox',
          messageId: 'local-mail',
          taskId: 'local-task',
          workspaceId,
          userId: 'run-reader',
          chatId,
          userMessageId: 'local-message',
        })
        expect(prepared.storedAttachments, JSON.stringify(fixture.errors)).toHaveLength(1)
        const [row] = await db
          .select()
          .from(workspaceFiles)
          .where(eq(workspaceFiles.key, prepared.storedAttachments[0].key))
        expect(row).toMatchObject({
          workspaceId,
          userId: 'run-reader',
          chatId,
          messageId: 'local-message',
          context: 'mothership',
          sizeBytes: bytes.length,
        })
        const reference = `uploads/${encodeURIComponent(filename)}`
        expect(prepared.context[0].content).toContain(reference)
        const read = await readWorkspaceFileText.execute({
          principal: { kind: 'personal_api_key', userId: 'run-reader', keyId: 'local-key' },
          input: { workspaceId, reference },
        })
        expect(read.file.id).toBe(row.id)
        expect(read.text).toContain('alpha')
        expect(read.text).toContain('17')
        expect(read.text).toContain('beta')
        expect(read.text).toContain('23')
        expect(read.byteCount).toBe(bytes.length)
        expect(read.truncated).toBe(false)
        expect(read.degraded).toBe(false)
        expect(executeInSandbox).not.toHaveBeenCalled()
      } finally {
        fixture.inboxBytes.delete(attachmentId)
      }
    })

    it.each(['csv', 'pdf'] as const)(
      'keeps same-named %s attachment reads inside the requesting Mothership chat',
      async (extension) => {
        const name = `shared-${generateId()}.${extension}`
        const chats = [generateId(), generateId()]
        const attachmentIds = [generateId(), generateId()]
        const fileIds: string[] = []
        try {
          for (const [index, chatId] of chats.entries()) {
            const pdf = await PDFDocument.create()
            pdf.addPage([100 + index, 200])
            const bytes =
              extension === 'pdf'
                ? Buffer.from(await pdf.save())
                : Buffer.from(`chat,amount\n${index === 0 ? 'first,17' : 'second,23'}\n`)
            fixture.inboxBytes.set(attachmentIds[index], bytes)
            const prepared = await prepareInboxAttachments({
              attachments: [
                {
                  attachment_id: attachmentIds[index],
                  filename: name,
                  content_type: extension === 'pdf' ? 'application/pdf' : 'text/csv',
                  size: bytes.length,
                },
              ],
              inboxProviderId: 'local-inbox',
              messageId: 'local-mail',
              taskId: 'local-task',
              workspaceId,
              userId: 'run-reader',
              chatId,
              userMessageId: generateId(),
            })
            expect(prepared.storedAttachments, JSON.stringify(fixture.errors)).toHaveLength(1)
            const [row] = await db
              .select()
              .from(workspaceFiles)
              .where(eq(workspaceFiles.key, prepared.storedAttachments[0].key))
            fileIds.push(row.id)
          }
          const read = async (chatId: string) =>
            executeAgentCliRequest(
              {
                invocation:
                  extension === 'pdf'
                    ? {
                        kind: 'augmentation',
                        name: 'files view',
                        positionals: [`uploads/${encodeURIComponent(name)}`],
                        flags: {},
                      }
                    : {
                        kind: 'cli',
                        argv: ['files', 'read', `uploads/${encodeURIComponent(name)}`],
                      },
              },
              {
                workspaceId,
                userId: 'run-reader',
                chatId,
                resolvedSecretTraceRegistry: new ResolvedSecretTraceRegistry([], {
                  userId: 'run-reader',
                  workspaceId,
                }),
              }
            )
          const first = await read(chats[0])
          expect(first.exitCode, first.stderr).toBe(0)
          const second = await read(chats[1])
          expect(second.exitCode, second.stderr).toBe(0)
          if (extension === 'csv') {
            expect(first.stdout).toContain('first')
            expect(first.stdout).not.toContain('second')
            expect(second.stdout).toContain('second')
          } else {
            for (const [index, result] of [first, second].entries()) {
              expect(result.observations).toHaveLength(1)
              const observation = result.observations?.[0]
              if (!observation) throw new Error('Expected a PDF observation')
              expect(observation.resourceId).toBe(fileIds[index])
              expect(Buffer.from(observation.data, 'base64')).toEqual(
                fixture.inboxBytes.get(attachmentIds[index])
              )
            }
          }
          const absent = await read(generateId())
          expect(absent.exitCode).not.toBe(0)
          expect(absent.stdout).not.toContain('second')
          expect(absent.observations).toBeUndefined()
          const reference = `uploads/${encodeURIComponent(name)}`
          for (const [index, chatId] of chats.entries()) {
            const context: Parameters<typeof resolveInputFiles>[0] = {
              workflowId,
              workspaceId,
              userId: 'run-reader',
              chatId,
              toolCallId: generateId(),
              copilotToolExecution: true,
              sandboxProfile: 'mothership',
            }
            const mediaReference = await resolveCopilotWorkspaceFileReference(
              context,
              fileOperations.readContent,
              { workspaceId, reference }
            )
            expect(mediaReference.id).toBe(fileIds[index])
            const mounts = await resolveInputFiles(
              context,
              [{ path: reference, sandboxPath: '/tmp/incoming.csv' }],
              undefined,
              undefined,
              new ResolvedSecretTraceRegistry([], { userId: 'run-reader', workspaceId })
            )
            expect(mounts).toHaveLength(1)
            const mount = mounts[0]
            if (mount.type === 'url') throw new Error('Expected inline mount bytes')
            expect(Buffer.from(mount.content, mount.encoding ?? 'utf8')).toEqual(
              fixture.inboxBytes.get(attachmentIds[index])
            )
          }
          if (extension === 'csv') {
            const publicRead = await fileTextRoute(
              new NextRequest(
                `https://sim.test/api/v2/files/${encodeURIComponent(reference)}/text?workspaceId=${workspaceId}`,
                { headers: { 'x-api-key': 'local-key' } }
              ),
              { params: Promise.resolve({ fileId: reference }) }
            )
            expect(publicRead.status).toBe(200)
            expect((await publicRead.json()).data.fileId).toBe(fileIds[1])
          }
          expect(executeInSandbox).not.toHaveBeenCalled()
        } finally {
          for (const id of attachmentIds) fixture.inboxBytes.delete(id)
        }
      }
    )

    it
      .skipIf(process.env.SIM_HELPERS_SMOKE !== '1' || !process.env.MSHIP_WORKER_ROOT)
      .each([
        'connected',
        'fork',
        'execute-connected',
        'execute-lost-final',
        'execute-lost-initial',
        'execute-live',
        'execute-partial',
        'controller-cli-long',
        'lost-handoff',
        'lost-final',
        'partial-final',
        'live-gap',
        'live-partial',
        'missing-final-chunk',
        'replayed-text',
        'relay-gap',
        'relay-interrupted',
        'relay-terminal-lost',
        'relay-first-frame',
        'relay-prefix',
        'relay-attach-lost',
        'relay-overlap',
        'controller-overlap',
        'child-connected',
        'child-cli-long',
        'child-failed-check',
        'child-lost-start',
        'child-partial-start',
        'child-owner-exit',
      ] as const)(
      'returns actual failed-run diagnostics through the controller (%s)',
      async (connection) => {
        const oneShot = connection.startsWith('execute-')
        const executeLive = ['execute-live', 'execute-partial', 'execute-lost-initial'].includes(
          connection
        )
        const initialRoute = oneShot ? '/api/mothership/execute' : '/api/mothership'
        const delayedCli = connection.endsWith('cli-long')
        const workerRoot = process.env.MSHIP_WORKER_ROOT
        if (!workerRoot)
          throw new Error('MSHIP_WORKER_ROOT must point to the sibling worker checkout')
        const spawnWorker = (port = '0') =>
          spawn('bun', ['tools/probes/src/controller-run-read.ts'], {
            cwd: workerRoot,
            env: {
              PATH: process.env.PATH,
              NODE_ENV: 'test',
              DATABASE_URL: process.env.MSHIP_TEST_DATABASE_URL,
              REDIS_URL: 'redis://127.0.0.1:6379/14',
              ANTHROPIC_API_KEY: 'local-scripted-provider',
              COPILOT_INBOUND_API_KEY: 'local-controller-probe-key',
              COPILOT_RUN_DEADLINE_MS: '20000',
              MSHIP_PROBE_WORKFLOW_ID: workflowId,
              MSHIP_PROBE_PORT: port,
              MSHIP_PROBE_DELEGATE: connection.startsWith('child-') ? '1' : '0',
              MSHIP_PROBE_EXECUTE: oneShot ? '1' : '0',
              MSHIP_PROBE_PAUSE_BEFORE_TEXT: connection === 'execute-lost-initial' ? '1' : '0',
              MSHIP_PROBE_CHECK_FAIL: connection === 'child-failed-check' ? '1' : '0',
              MSHIP_PROBE_PAUSE_REPORT:
                connection.startsWith('live-') || connection.startsWith('relay-') || executeLive
                  ? '1'
                  : '0',
              ...(connection.startsWith('relay-')
                ? { MSHIP_PROBE_RELAY_FAULT: connection.slice('relay-'.length) }
                : {}),
            },
            stdio: ['pipe', 'pipe', 'pipe'],
          })
        let child = spawnWorker()
        let exited = once(child, 'exit')
        let lines = createInterface({ input: child.stdout })
        let diagnostics = ''
        let relayUrl: string | undefined
        const executionStarted = createSignal()
        const releaseExecution = createSignal()
        const secondSawCall = createSignal()
        const waitForReady = () => {
          const workerProcess = child
          workerProcess.stderr.on('data', (chunk: Buffer) => {
            diagnostics += chunk.toString()
          })
          return new Promise<string>((resolve) => {
            lines.on('line', (line) => {
              diagnostics += `${line}\n`
              if (
                (connection.startsWith('live-') || executeLive) &&
                line.includes('"msg":"Duplicate send"')
              )
                workerProcess.stdin.write('release\n')
              if (line.includes('"probe":"relay-attached"')) workerProcess.stdin.write('release\n')
              if (line.includes('"probe":"execute-model-call"')) executionStarted.resolve()
              if (!line.startsWith('{"probe":')) return
              const message: unknown = JSON.parse(line)
              if (
                message &&
                typeof message === 'object' &&
                'port' in message &&
                typeof message.port === 'number'
              ) {
                if ('relayPort' in message && typeof message.relayPort === 'number')
                  relayUrl = `http://127.0.0.1:${message.relayPort}`
                resolve(`http://127.0.0.1:${message.port}`)
              }
            })
          })
        }
        const ready = waitForReady()
        let startupTimeout = setTimeout(() => child.kill(), 10_000)
        let restoreClock = () => {}
        let finishDelay = () => {}
        try {
          fixture.workerUrl = await Promise.race([
            ready,
            exited.then(() => {
              throw new Error(`Worker probe exited before readiness: ${diagnostics}`)
            }),
          ])
          clearTimeout(startupTimeout)
          vi.stubEnv('COPILOT_API_KEY', 'local-controller-probe-key')
          vi.unstubAllGlobals()
          const nativeFetch = globalThis.fetch
          const nativeSetTimeout = globalThis.setTimeout
          if (delayedCli) {
            const nativeNow = Date.now
            const start = nativeNow()
            let offset: number | undefined
            const clock = vi.spyOn(Date, 'now').mockImplementation(() => {
              const now = nativeNow()
              return offset === undefined ? start + (now - start) * 100 : now + offset
            })
            restoreClock = () => clock.mockRestore()
            // Resume compares absolute deadlines. Stop accelerating before entering the workflow engine.
            finishDelay = () => {
              offset = Date.now() - nativeNow()
            }
            // Cross both the handler and resume watchdogs without slowing real workflow execution.
            vi.stubGlobal(
              'setTimeout',
              Object.assign(
                (...[handler, delay, ...args]: Parameters<typeof setTimeout>) =>
                  nativeSetTimeout(
                    handler,
                    delay && delay >= 60_000 ? delay / 100 : delay,
                    ...args
                  ),
                { __promisify__: nativeSetTimeout.__promisify__ }
              )
            )
          }
          const workerRequests: string[] = []
          const receivedTextCounts: number[] = []
          const activityReceipts: unknown[] = []
          let replayedToolFrames = 0
          let responseDropped = false
          vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = new URL(input instanceof Request ? input.url : input)
            if (url.origin === identity.endpoint) {
              if (delayedCli && url.pathname.endsWith('/execute')) {
                await new Promise((resolve) => nativeSetTimeout(resolve, 1_100))
                finishDelay()
              }
              if (connection === 'controller-overlap' && url.pathname.endsWith('/execute')) {
                executionStarted.resolve()
                await releaseExecution.promise
              }
              return identity.transport(input, init)
            }
            if (url.origin !== fixture.workerUrl)
              throw new Error(`Unexpected external request: ${url.origin}`)
            workerRequests.push(url.pathname)
            let streamId: string | undefined
            if (typeof init?.body === 'string') {
              const payload: unknown = JSON.parse(init.body)
              if (payload && typeof payload === 'object' && 'receivedActivity' in payload) {
                activityReceipts.push(payload.receivedActivity)
              }
              if (
                payload &&
                typeof payload === 'object' &&
                'streamId' in payload &&
                typeof payload.streamId === 'string'
              )
                streamId = payload.streamId
              if (
                payload &&
                typeof payload === 'object' &&
                'receivedTextChars' in payload &&
                typeof payload.receivedTextChars === 'number'
              )
                receivedTextCounts.push(payload.receivedTextChars)
            }
            if (
              connection === 'child-owner-exit' &&
              !responseDropped &&
              url.pathname === '/api/tools/resume'
            ) {
              if (!streamId) throw new Error('Missing interrupted run identity')
              responseDropped = true
              child.kill('SIGKILL')
              await exited
              lines.close()
              await db.execute(
                sql`UPDATE worker.runs SET heartbeat_at = now() - interval '5 minutes' WHERE id = ${streamId}`
              )
              child = spawnWorker(new URL(fixture.workerUrl).port)
              exited = once(child, 'exit')
              lines = createInterface({ input: child.stdout })
              startupTimeout = setTimeout(() => child.kill(), 10_000)
              const replacement = await Promise.race([
                waitForReady(),
                exited.then(() => {
                  throw new Error(`Replacement worker exited: ${diagnostics}`)
                }),
              ])
              clearTimeout(startupTimeout)
              expect(replacement).toBe(fixture.workerUrl)
            }
            const response = await nativeFetch(input, init)
            if (
              connection === 'execute-lost-initial' &&
              !responseDropped &&
              url.pathname === initialRoute
            ) {
              await executionStarted.promise
              responseDropped = true
              await response.body?.cancel()
              throw new TypeError('Local fixture lost the accepted response before model text')
            }
            if (
              connection === 'execute-lost-final' &&
              !responseDropped &&
              url.pathname === initialRoute
            ) {
              await response.text()
              responseDropped = true
              throw new TypeError('Local fixture lost the complete one-shot response')
            }
            if (
              (connection === 'child-lost-start' || connection === 'child-partial-start') &&
              !responseDropped &&
              url.pathname === '/api/mothership'
            ) {
              const body = await response.text()
              responseDropped = true
              if (connection === 'child-partial-start') {
                const frames = body.split('\n\n')
                const start = frames.findIndex((frame) => frame.includes('"type":"span"'))
                if (start < 0) throw new Error('Expected a live child start')
                return new Response(
                  `${frames.slice(0, start + 1).join('\n\n')}\n\ndata: [DONE]\n\n`,
                  { status: response.status, headers: response.headers }
                )
              }
              throw new TypeError('Local fixture lost the child starts and first tool handoff')
            }

            if (
              (connection.startsWith('live-') || connection.startsWith('relay-') || executeLive) &&
              !responseDropped &&
              url.pathname === (oneShot ? initialRoute : '/api/tools/resume')
            ) {
              if (!response.body) throw new Error('Expected the live worker response body')
              const reader = response.body.getReader()
              let pending = ''
              const decoder = new TextDecoder()
              for (;;) {
                const part = await reader.read()
                if (part.done) break
                pending += decoder.decode(part.value, { stream: true })
                if (pending.includes('"type":"text"')) {
                  responseDropped = true
                  await reader.cancel()
                  if (connection.startsWith('relay-')) {
                    if (!relayUrl || !streamId) throw new Error('Missing relay fixture identity')
                    return nativeFetch(`${relayUrl}/?streamId=${streamId}`, {
                      signal: init?.signal,
                    })
                  }
                  if (connection === 'live-partial' || connection === 'execute-partial') {
                    let sent = false
                    return new Response(
                      new ReadableStream<Uint8Array>(
                        {
                          pull(controller) {
                            if (sent)
                              controller.error(new TypeError('Local fixture lost the live suffix'))
                            else {
                              sent = true
                              controller.enqueue(new TextEncoder().encode(pending))
                            }
                          },
                        },
                        { highWaterMark: 0 }
                      ),
                      { status: response.status, headers: response.headers }
                    )
                  }
                  throw new TypeError(
                    'Local fixture lost text while the worker is still generating'
                  )
                }
              }
              return new Response(pending, { status: response.status, headers: response.headers })
            }
            if (
              connection !== 'connected' &&
              connection !== 'fork' &&
              connection !== 'controller-overlap' &&
              !delayedCli &&
              connection !== 'child-connected' &&
              connection !== 'child-failed-check' &&
              url.pathname === '/api/tools/resume' &&
              !responseDropped
            ) {
              const body = await response.clone().text()
              if (connection === 'lost-handoff' || body.includes('"type":"complete"')) {
                responseDropped = true
                if (connection === 'missing-final-chunk' || connection === 'replayed-text') {
                  const frames = body.split('\n\n')
                  const textIndexes = frames.flatMap((frame, index) =>
                    frame.includes('"type":"text"') ? [index] : []
                  )
                  if (textIndexes.length < 2) throw new Error('Expected separate final text chunks')
                  if (connection === 'missing-final-chunk') frames.splice(textIndexes.at(-1)!, 1)
                  else frames.splice(textIndexes[0]!, 0, frames[textIndexes[0]!]!)
                  return new Response(frames.join('\n\n'), {
                    status: response.status,
                    headers: response.headers,
                  })
                }
                if (connection === 'partial-final') {
                  const frames = body.split('\n\n')
                  const textIndex = frames.findIndex((frame) => frame.includes('"type":"text"'))
                  if (textIndex < 0) throw new Error('Expected the final response text')
                  const prefix = `${frames.slice(0, textIndex + 1).join('\n\n')}\n\n`
                  let sent = false
                  return new Response(
                    new ReadableStream<Uint8Array>(
                      {
                        pull(controller) {
                          if (sent) {
                            controller.error(new TypeError('Local fixture lost the answer suffix'))
                          } else {
                            sent = true
                            controller.enqueue(new TextEncoder().encode(prefix))
                          }
                        },
                      },
                      { highWaterMark: 0 }
                    ),
                    { status: response.status, headers: response.headers }
                  )
                }
                throw new TypeError('Local fixture lost the accepted resume response')
              }
            }
            return response
          })
          fixture.permission = 'write'
          fixture.saved.set(
            workflowId,
            runnableState('throw new Error("Invoice amount must be a number");')
          )
          ensureHandlersRegistered()
          const chatId = generateId()
          const messageId = generateId()
          const runController = (resume?: { id: string; executionId: string }) =>
            runCopilotLifecycle(
              {
                ...(oneShot
                  ? {
                      messages: [
                        { role: 'system', content: 'Caller-authored extraction system.' },
                        { role: 'user', content: 'Return the extraction result.' },
                      ],
                    }
                  : {
                      message:
                        'Run the saved workflow and identify the failing block from its recorded log.',
                      workflowId,
                    }),
                userId: 'run-reader',
                workspaceId,
                chatId,
                messageId,
              },
              {
                userId: 'run-reader',
                workspaceId,
                workflowId,
                chatId,
                ...(resume ? { runId: resume.id, executionId: resume.executionId } : {}),
                goRoute: initialRoute,
                interactive: false,
                clientToolPickupExpected: false,
                flushAfterEvent: false,
                onEvent: (event) => {
                  if (event.type === 'tool' && event.payload.replay) replayedToolFrames++
                  if (resume && isToolCallStreamEvent(event) && !event.payload.replay)
                    secondSawCall.resolve()
                },
                abortSignal: AbortSignal.timeout(20_000),
                executionContext: {
                  userId: 'run-reader',
                  workspaceId,
                  workflowId,
                  chatId,
                  userPermission: 'write',
                  resolvedSecretTraceRegistry: new ResolvedSecretTraceRegistry([], {
                    userId: 'run-reader',
                    workspaceId,
                  }),
                },
              }
            )
          const controllerStartedAt = Date.now()
          const first = runController()
          let result: Awaited<ReturnType<typeof runCopilotLifecycle>>
          if (connection === 'controller-overlap') {
            await Promise.race([
              executionStarted.promise,
              first.then(() => {
                throw new Error('First controller ended before claiming the workflow execution')
              }),
            ])
            const [activeRun] = await db
              .select()
              .from(copilotRuns)
              .where(eq(copilotRuns.streamId, messageId))
            if (!activeRun) throw new Error('Missing shared controller run')
            const [activeCall] = await db
              .select()
              .from(copilotAsyncToolCalls)
              .where(eq(copilotAsyncToolCalls.runId, activeRun.id))
            expect(activeCall.executionStartedAt).toBeInstanceOf(Date)
            expect(activeCall.executionSettledAt).toBeNull()
            const second = runController(activeRun)
            try {
              await Promise.race([
                secondSawCall.promise,
                second.then(() => {
                  throw new Error('Second controller ended before observing the owned tool')
                }),
              ])
              expect(fixture.requests.filter((path) => path.endsWith('/execute'))).toHaveLength(0)
            } finally {
              releaseExecution.resolve()
            }
            const results = await Promise.all([first, second])
            for (const observed of results)
              expect(
                observed.success,
                JSON.stringify({ observed, errors: fixture.errors, diagnostics })
              ).toBe(true)
            expect(results[1].content).toBe(results[0].content)
            result = results[0]
          } else result = await first
          expect(
            result.success,
            JSON.stringify({ result, errors: fixture.errors, diagnostics })
          ).toBe(true)
          if (oneShot) {
            expect(result.content).toBe(
              JSON.stringify({ surface: 'execute', answer: 'Caller-authored answer' })
            )
            expect(fixture.requests).toEqual([])
            expect(responseDropped).toBe(connection !== 'execute-connected')
            expect(workerRequests).toEqual(
              Array(connection === 'execute-connected' ? 1 : 2).fill(initialRoute)
            )
            expect(
              receivedTextCounts.some((count) => count > 0 && count < result.content.length)
            ).toBe(connection === 'execute-partial')
            expect(diagnostics.match(/"probe":"execute-model-call"/g)).toHaveLength(1)
            const [run] = await db
              .select()
              .from(copilotRuns)
              .where(eq(copilotRuns.streamId, messageId))
            expect(run.status).toBe('complete')
            expect(executeInSandbox).not.toHaveBeenCalled()
            expect(executeShellInSandbox).not.toHaveBeenCalled()
            return
          }
          if (delayedCli) expect(Date.now() - controllerStartedAt).toBeGreaterThan(90_000)
          expect(
            receivedTextCounts.some((count) => count > 0 && count < result.content.length)
          ).toBe(
            [
              'partial-final',
              'live-partial',
              'missing-final-chunk',
              'relay-gap',
              'relay-interrupted',
            ].includes(connection)
          )
          if (['relay-first-frame', 'relay-prefix', 'relay-attach-lost'].includes(connection)) {
            expect(workerRequests.filter((path) => path === '/api/tools/resume')).toHaveLength(3)
          }
          if (connection === 'relay-overlap') {
            expect(workerRequests.filter((path) => path === '/api/tools/resume')).toHaveLength(2)
          }
          if (connection === 'relay-terminal-lost')
            expect(receivedTextCounts).toContain(result.content.length)
          expect(activityReceipts.length).toBeGreaterThan(0)
          for (const receipt of activityReceipts) {
            expect(receipt).toMatchObject({
              emitterId: expect.any(String),
              sequence: expect.any(Number),
            })
            expect(JSON.stringify(receipt).length).toBeLessThan(200)
          }
          if (
            delayedCli ||
            ['connected', 'child-connected', 'child-failed-check'].includes(connection)
          ) {
            expect(replayedToolFrames).toBe(0)
          }
          const report: unknown = JSON.parse(result.content)
          expect(report).toMatchObject({
            blockId,
            blockName: 'Validate invoice',
            error: expect.stringContaining('Invoice amount must be a number'),
          })
          if (
            !report ||
            typeof report !== 'object' ||
            !('runId' in report) ||
            typeof report.runId !== 'string'
          )
            throw new Error('Model report lost the execution identity')
          const [log] = await db
            .select()
            .from(workflowExecutionLogs)
            .where(eq(workflowExecutionLogs.executionId, report.runId))
          expect(log?.status).toBe('failed')
          expect(fixture.requests.filter((path) => path.endsWith('/execute'))).toHaveLength(1)
          expect(fixture.requests).toContain(`/api/v2/logs/${report.runId}`)
          expect(workerRequests[0]).toBe('/api/mothership')
          expect(
            workerRequests.filter((path) => path === '/api/tools/resume').length
          ).toBeGreaterThanOrEqual(2)
          const [run] = await db
            .select()
            .from(copilotRuns)
            .where(eq(copilotRuns.streamId, messageId))
          expect(run?.status).toBe('complete')
          const calls = await db
            .select()
            .from(copilotAsyncToolCalls)
            .where(eq(copilotAsyncToolCalls.runId, run.id))
          expect(calls.length).toBeGreaterThanOrEqual(2)
          expect(responseDropped).toBe(
            connection !== 'connected' &&
              connection !== 'fork' &&
              connection !== 'controller-overlap' &&
              !delayedCli &&
              connection !== 'child-connected' &&
              connection !== 'child-failed-check'
          )
          expect(
            calls.find((call) => call.toolCallId.startsWith('execute-saved-workflow-'))
          ).toMatchObject({
            status: 'failed',
            result: { exitCode: 1, stdout: expect.stringContaining(report.runId) },
          })
          for (const call of calls) {
            expect(call.executionStartedAt).toBeInstanceOf(Date)
            expect(call.executionSettledAt).toBeInstanceOf(Date)
          }
          if (connection.startsWith('child-')) {
            const children = result.contentBlocks.filter((block) => block.type === 'subagent')
            expect(children.map((block) => block.subagentName).sort()).toEqual([
              'Check instructions',
              'Diagnose workflow',
            ])
            for (const child of children) expect(child.endedAt).toBeTypeOf('number')
            expect(
              children.find((block) => block.subagentName === 'Check instructions')?.error
            ).toBe(connection === 'child-failed-check' ? 'Independent check failed' : undefined)
            if (connection !== 'child-failed-check') {
              const check = children.find((block) => block.subagentName === 'Check instructions')
              const discovery = result.contentBlocks.filter(
                (block) => block.type === 'tool_call' && block.toolCall?.id.startsWith('check-cli-')
              )
              expect(discovery).toHaveLength(1)
              expect(discovery[0]).toMatchObject({
                parentToolCallId: check?.parentToolCallId,
                toolCall: {
                  name: 'sim_cli',
                  params: { args: ['help'] },
                  status: 'success',
                  result: {
                    success: true,
                    output: { exitCode: 0, stdout: expect.stringContaining('workflows') },
                  },
                },
              })
            }
            const diagnostic = children.find((block) => block.subagentName === 'Diagnose workflow')
            if (connection === 'child-owner-exit') expect(diagnostic?.error).toMatch(/interrupt/i)
            expect(
              result.contentBlocks.some(
                (block) =>
                  block.type === 'tool_call' &&
                  block.parentToolCallId === diagnostic?.parentToolCallId &&
                  block.toolCall?.name === 'cli_workflows_run'
              )
            ).toBe(true)
          }
          expect(executeInSandbox).not.toHaveBeenCalled()
          expect(executeShellInSandbox).not.toHaveBeenCalled()
          if (connection === 'fork') {
            await db.insert(copilotChats).values({
              id: chatId,
              userId: 'run-reader',
              workspaceId,
              type: 'mothership',
              title: 'Source diagnostics',
            })
            const assistantId = generateId()
            await appendCopilotChatMessages(chatId, [
              {
                id: messageId,
                role: 'user',
                content:
                  'Run the saved workflow and identify the failing block from its recorded log.',
                timestamp: new Date().toISOString(),
              },
              {
                id: assistantId,
                role: 'assistant',
                content: result.content,
                timestamp: new Date().toISOString(),
              },
            ])
            const attachmentId = generateId()
            const missingAttachmentId = generateId()
            const filename = `fork-${generateId()}.csv`
            fixture.inboxBytes.set(attachmentId, Buffer.from('branch,value\noriginal,42\n'))
            fixture.inboxBytes.set(missingAttachmentId, Buffer.from('branch,value\nmissing,99\n'))
            const prepared = await prepareInboxAttachments({
              attachments: [
                { attachment_id: attachmentId, filename, content_type: 'text/csv', size: 25 },
                {
                  attachment_id: missingAttachmentId,
                  filename: `missing-${filename}`,
                  content_type: 'text/csv',
                  size: 25,
                },
              ],
              inboxProviderId: 'local-inbox',
              messageId: 'local-mail',
              taskId: 'local-task',
              workspaceId,
              userId: 'run-reader',
              chatId,
              userMessageId: messageId,
            })
            fixture.inboxBytes.delete(attachmentId)
            fixture.inboxBytes.delete(missingAttachmentId)
            expect(prepared.storedAttachments).toHaveLength(2)
            fixture.storageKeys.delete(prepared.storedAttachments[1].key)
            const sourceFiles = await db
              .select()
              .from(workspaceFiles)
              .where(eq(workspaceFiles.chatId, chatId))
            await db
              .update(copilotChats)
              .set({
                resources: sourceFiles.map((file) => ({
                  type: 'file' as const,
                  id: file.id,
                  title: file.originalName,
                })),
              })
              .where(eq(copilotChats.id, chatId))
            const forkResponse = await forkChatRoute(
              new NextRequest(`https://sim.test/api/mothership/chats/${chatId}/fork`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ upToMessageId: assistantId }),
              }),
              { params: Promise.resolve({ chatId }) }
            )
            expect(forkResponse.status, JSON.stringify(fixture.errors)).toBe(200)
            const forkPayload = await forkResponse.json()
            expect(forkPayload.failedFileCopies).toBe(1)
            const forkId = forkPayload.id
            expect(
              (await loadCopilotChatMessages(forkId)).map((message) => message.content)
            ).toEqual([
              'Run the saved workflow and identify the failing block from its recorded log.',
              result.content,
            ])
            const copiedFiles = await db
              .select()
              .from(workspaceFiles)
              .where(eq(workspaceFiles.chatId, forkId))
            expect(copiedFiles).toHaveLength(1)
            const copiedFile = copiedFiles[0]
            const [forkedChat] = await db
              .select()
              .from(copilotChats)
              .where(eq(copilotChats.id, forkId))
            expect(forkedChat.resources).toEqual([
              { type: 'file', id: copiedFile.id, title: filename },
            ])
            expect(copiedFile.key).not.toBe(prepared.storedAttachments[0].key)
            await db
              .update(workspaceFiles)
              .set({ deletedAt: new Date() })
              .where(eq(workspaceFiles.chatId, chatId))
            const fileRead = await executeAgentCliRequest(
              { invocation: { kind: 'cli', argv: ['files', 'read', `uploads/${filename}`] } },
              {
                userId: 'run-reader',
                workspaceId,
                chatId: forkId,
                resolvedSecretTraceRegistry: new ResolvedSecretTraceRegistry([], {
                  userId: 'run-reader',
                  workspaceId,
                }),
              }
            )
            expect(fileRead.exitCode, fileRead.stderr).toBe(0)
            expect(fileRead.stdout).toContain('original')
            const continued = await runCopilotLifecycle(
              {
                message: 'Summarize the diagnosed failure without running it again.',
                userId: 'run-reader',
                workspaceId,
                chatId: forkId,
                messageId: generateId(),
              },
              {
                userId: 'run-reader',
                workspaceId,
                chatId: forkId,
                interactive: false,
                clientToolPickupExpected: false,
                flushAfterEvent: false,
                abortSignal: AbortSignal.timeout(20_000),
              }
            )
            expect(
              continued.success,
              JSON.stringify({ continued, errors: fixture.errors, diagnostics })
            ).toBe(true)
            expect(continued.content).toBe(result.content)
            expect(fixture.requests.filter((path) => path.endsWith('/execute'))).toHaveLength(1)
          }
        } finally {
          restoreClock()
          releaseExecution.resolve()
          clearTimeout(startupTimeout)
          child.kill()
          await exited
          lines.close()
          vi.unstubAllGlobals()
          vi.unstubAllEnvs()
        }
      },
      40_000
    )

    it
      .skipIf(process.env.SIM_HELPERS_SMOKE !== '1' || !process.env.MSHIP_WORKER_ROOT)
      .each(['valid', 'rewrite'] as const)(
      'verifies surgical CLI edits against physical graph storage and saved execution: %s',
      async (mode) => {
        fixture.permission = 'admin'
        const workflowId = generateId()
        await db.insert(workflow).values({
          id: workflowId,
          workspaceId,
          userId: 'run-reader',
          name: 'Surgical insertion',
          lastSynced: now,
          createdAt: now,
          updatedAt: now,
          isDeployed: false,
        })
        fixture.physicalWorkflows.add(workflowId)
        const state = surgicalState()
        await replaceWorkflowNormalizedState({
          workflowId,
          workspaceId,
          attributedUserId: 'run-reader',
          state,
        })
        await runCompanionOracle({
          testFile: 'benchmark-surgical-insert-postgres.test.ts',
          environmentKey: 'MSHIP_SURGICAL_FIXTURE',
          fixture: { workflowId, mode },
        })
        await Promise.all(postExecution.mock.calls.map(([promise]) => promise))
        const blocks = await db
          .select()
          .from(workflowBlocks)
          .where(eq(workflowBlocks.workflowId, workflowId))
        const edges = await db
          .select()
          .from(workflowEdges)
          .where(eq(workflowEdges.workflowId, workflowId))
        const runs = await db
          .select()
          .from(workflowExecutionLogs)
          .where(eq(workflowExecutionLogs.workflowId, workflowId))
        expect(fixture.errors).toEqual([])
        expect(blocks).toHaveLength(4)
        expect(edges).toHaveLength(3)
        expect(blocks.map((block) => block.id)).toEqual(
          expect.arrayContaining(Object.keys(state.blocks))
        )
        expect(runs).toHaveLength(3)
        expect(runs.every((run) => run.status === 'completed')).toBe(true)
        expect(executeInSandbox).not.toHaveBeenCalled()
        expect(executeShellInSandbox).not.toHaveBeenCalled()
      },
      60_000
    )

    it
      .skipIf(process.env.SIM_HELPERS_SMOKE !== '1' || !process.env.MSHIP_WORKER_ROOT)
      .each(['valid', 'empty-probe'] as const)(
      'runs an idempotent saved table pipeline with physical row and appended-file effects: %s',
      async (mode) => {
        fixture.permission = 'write'
        const tableId = generateId()
        const workflowId = generateId()
        await db.insert(workflow).values({
          id: workflowId,
          workspaceId,
          userId: 'run-reader',
          name: `${tableId}-pending`,
          lastSynced: now,
          createdAt: now,
          updatedAt: now,
          isDeployed: false,
        })
        const fileId = generateId()
        const fileName = `${tableId}-log.md`
        const timestamp = new Date(Date.now() - 1000)
        await db.insert(userTableDefinitions).values({
          id: tableId,
          workspaceId,
          name: `fx_orders_${tableId}`,
          createdBy: 'run-reader',
          createdAt: timestamp,
          updatedAt: timestamp,
          maxRows: 10000,
          rowCount: 4,
          schema: {
            columns: [
              { id: 'col_order', name: 'order_id', type: 'string' },
              { id: 'col_status', name: 'status', type: 'string' },
              { id: 'col_amount', name: 'amount', type: 'number' },
            ],
          },
        })
        const original = ['pending', 'cancelled', 'pending', 'fulfilled'].map((status, index) => ({
          id: generateId(),
          tableId,
          workspaceId,
          data: { col_order: generateId(), col_status: status, col_amount: index + 20 },
          createdAt: timestamp,
          updatedAt: timestamp,
          position: index,
          createdBy: 'run-reader',
        }))
        await db.insert(userTableRows).values(original)
        const key = `workspace/${workspaceId}/${fileId}.md`
        const path = join(fixture.directory, fileId)
        await writeFile(path, 'Existing history\n')
        fixture.storageKeys.set(key, path)
        await db.insert(workspaceFiles).values({
          id: fileId,
          key,
          userId: 'run-reader',
          workspaceId,
          context: 'workspace',
          originalName: fileName,
          contentType: 'text/markdown',
          sizeBytes: 17,
          uploadedAt: timestamp,
          updatedAt: timestamp,
          contentUpdatedAt: timestamp,
          secretProvenanceVersion: 1,
        })
        await db.insert(workspaceFileSecretProvenance).values({
          fileId,
          contentUpdatedAt: timestamp,
          status: 'exact',
          entries: [],
          updatedAt: timestamp,
        })
        const saved = pipelineState(tableId, fileName)
        fixture.saved.set(workflowId, structuredClone(saved))
        await runPipelineOracle(tableId, workflowId, mode)
        await Promise.all(postExecution.mock.calls.map(([promise]) => promise))
        const rows = await db.select().from(userTableRows).where(eq(userTableRows.tableId, tableId))
        expect(rows).toHaveLength(7)
        for (const row of original) {
          expect(rows.find((item) => item.id === row.id)).toMatchObject({
            id: row.id,
            createdAt: row.createdAt,
            data: {
              ...row.data,
              col_status: row.data.col_status === 'pending' ? 'processed' : row.data.col_status,
            },
          })
        }
        const [file] = await db.select().from(workspaceFiles).where(eq(workspaceFiles.id, fileId))
        const storedPath = fixture.storageKeys.get(file.key)
        if (!storedPath) throw new Error('Appended file bytes are missing')
        const log = await readFile(storedPath, 'utf8')
        expect(log.startsWith('Existing history\n')).toBe(true)
        expect(
          log
            .split('\n')
            .filter(Boolean)
            .slice(1)
            .map((line) => line.split(' ')[1])
        ).toEqual(mode === 'valid' ? ['2', '0', '2', '0'] : ['2', '0'])
        const runs = await db
          .select()
          .from(workflowExecutionLogs)
          .where(eq(workflowExecutionLogs.workflowId, workflowId))
        const count = mode === 'valid' ? 4 : 3
        expect(runs).toHaveLength(count)
        expect(new Set(runs.map((run) => run.executionId)).size).toBe(count)
        expect(runs.every((run) => run.status === 'completed')).toBe(true)
        if (mode === 'valid') expect(fixture.saved.get(workflowId)).toEqual(saved)
        expect(executeInSandbox).not.toHaveBeenCalled()
        expect(executeShellInSandbox).not.toHaveBeenCalled()
      },
      60_000
    )

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

function runnableState(
  code: string
): Pick<WorkflowState, 'blocks' | 'edges' | 'loops' | 'parallels'> {
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

function surgicalState(): ReturnType<typeof runnableState> {
  const template = runnableState('return String(<start.text>).trim();')
  const startId = generateId()
  const validateId = generateId()
  const transformId = generateId()
  return {
    blocks: {
      [startId]: {
        ...template.blocks.start,
        id: startId,
        subBlocks: {
          inputFormat: {
            id: 'inputFormat',
            type: 'input-format',
            value: JSON.stringify([{ name: 'text', type: 'string' }]),
          },
        },
        outputs: { text: { type: 'string' } },
      },
      [validateId]: { ...template.blocks[blockId], id: validateId, name: 'validate' },
      [transformId]: {
        ...structuredClone(template.blocks[blockId]),
        id: transformId,
        name: 'transform',
        position: { x: 0, y: 200 },
        subBlocks: {
          ...template.blocks[blockId].subBlocks,
          code: {
            id: 'code',
            type: 'code',
            value: 'return String(<validate.result>).toUpperCase();',
          },
        },
      },
    },
    edges: [
      {
        id: generateId(),
        source: startId,
        target: validateId,
        sourceHandle: 'source',
        targetHandle: 'target',
      },
      {
        id: generateId(),
        source: validateId,
        target: transformId,
        sourceHandle: 'source',
        targetHandle: 'target',
      },
    ],
    loops: {},
    parallels: {},
  }
}

async function runPipelineOracle(
  tableId: string,
  workflowId: string,
  mode: 'valid' | 'empty-probe'
): Promise<void> {
  let executions = 0
  await runCompanionOracle({
    testFile: 'benchmark-table-pipeline-postgres.test.ts',
    environmentKey: 'MSHIP_PIPELINE_FIXTURE',
    fixture: { tableId, workflowId, runTag: tableId, mode },
    beforeRequest: (url) => {
      if (url?.startsWith(`/api/v2/workflows/${workflowId}/execute`)) {
        executions++
        if (executions === 3 && mode === 'empty-probe') {
          fixture.saved.set(workflowId, runnableState('return "no work performed";'))
        }
      }
    },
  })
}

async function runCompanionOracle(options: {
  testFile: string
  environmentKey: string
  fixture: Record<string, string>
  beforeRequest?: (url: string | undefined) => void
}): Promise<void> {
  const workerRoot = process.env.MSHIP_WORKER_ROOT
  if (!workerRoot) throw new Error('Companion worker checkout is required')
  const server = createServer(async (incoming, outgoing) => {
    try {
      const chunks: Buffer[] = []
      for await (const chunk of incoming) chunks.push(Buffer.from(chunk))
      const headers = new Headers()
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value)
      }
      options.beforeRequest?.(incoming.url)
      const response = await identity.transport(`${identity.endpoint}${incoming.url}`, {
        method: incoming.method,
        headers,
        ...(chunks.length ? { body: Buffer.concat(chunks).toString('utf8') } : {}),
      })
      outgoing.writeHead(response.status, Object.fromEntries(response.headers))
      outgoing.end(Buffer.from(await response.arrayBuffer()))
    } catch (error) {
      fixture.errors.push(error)
      outgoing.writeHead(500).end(String(error))
    }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing local oracle address')
  const child = spawn('bun', ['test', `apps/server/test/${options.testFile}`], {
    cwd: workerRoot,
    env: {
      ...process.env,
      [options.environmentKey]: JSON.stringify({
        ...options.fixture,
        endpoint: `http://127.0.0.1:${address.port}`,
        workspaceId,
      }),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 50_000,
  })
  const output: string[] = []
  child.stdout.on('data', (data: Buffer) => output.push(data.toString()))
  child.stderr.on('data', (data: Buffer) => output.push(data.toString()))
  const closed = once(child, 'close')
  try {
    const [code] = await closed
    expect(code, JSON.stringify({ output: output.join(''), errors: fixture.errors })).toBe(0)
  } finally {
    child.kill()
    await closed
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
  }
}

function pipelineState(tableId: string, fileName: string) {
  const table = getLatestBlock('table')
  const file = getLatestBlock('file')
  if (!table || !file) throw new Error('Pipeline blocks are unavailable')
  const state = runnableState(
    'return "processed " + <processorders.updatedCount> + " orders at " + new Date().toISOString() + "\\n";'
  )
  state.blocks[blockId].name = 'Summarize orders'
  state.blocks.process = {
    id: 'process',
    type: table.type,
    name: 'Process orders',
    position: { x: 0, y: 50 },
    enabled: true,
    advancedMode: true,
    subBlocks: {
      operation: { id: 'operation', type: 'dropdown', value: 'update_rows_by_filter' },
      manualTableId: { id: 'manualTableId', type: 'short-input', value: tableId },
      filter: {
        id: 'filter',
        type: 'code',
        value: JSON.stringify({ field: 'status', op: 'eq', value: 'pending' }),
      },
      data: { id: 'data', type: 'code', value: JSON.stringify({ status: 'processed' }) },
    },
    outputs: table.outputs,
  }
  state.blocks.append = {
    id: 'append',
    type: file.type,
    name: 'Append summary',
    position: { x: 0, y: 150 },
    enabled: true,
    advancedMode: true,
    subBlocks: {
      operation: { id: 'operation', type: 'dropdown', value: 'file_append' },
      appendFileName: { id: 'appendFileName', type: 'short-input', value: fileName },
      appendContent: { id: 'appendContent', type: 'long-input', value: '<summarizeorders.result>' },
    },
    outputs: file.outputs,
  }
  state.edges = [
    { id: 'start-process', source: 'start', target: 'process' },
    { id: 'process-summary', source: 'process', target: blockId },
    { id: 'summary-append', source: blockId, target: 'append' },
  ]
  return state
}
