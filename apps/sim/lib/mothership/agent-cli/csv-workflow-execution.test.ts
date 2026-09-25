/**
 * @vitest-environment node
 *
 * Enable with SIM_HELPERS_SMOKE=1 and the installed Node isolated-vm runtime.
 * Real CLI, routes, application operations, execution service/core, registry,
 * serializer, DAG, Function isolate and file broker. Identity, admission/billing,
 * saved-state records, log persistence and physical storage are local fixtures.
 * Remote compute is rejected; no live server, model or cloud service is involved.
 */
import { createReadStream } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DelegatedPrincipal } from '@sim/auth/principal'
import type { PermissionType } from '@sim/platform-authz/workspace'
import { generateId } from '@sim/utils/id'
import { NextRequest } from 'next/server'
import type { EmbeddedCliIdentity } from 'sim/embed'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { v2FileSchema } from '@/lib/api/contracts/v2/files'
import { v2ExecuteWorkflowDataSchema } from '@/lib/api/contracts/v2/workflows'
import { executeInSandbox, executeShellInSandbox } from '@/lib/execution/remote-sandbox'
import { FUNCTION_EXECUTION_DELEGATION_AUDIENCE } from '@/lib/function-execution/application/authorization'
import type { CreateExecutorPrincipalFromExecutionContextInput } from '@/lib/internal/principals/executor'
import type { LoggingSession } from '@/lib/logs/execution/logging-session'
import { runCli } from '@/lib/mothership/agent-cli/run-cli'
import type {
  uploadWorkspaceFile,
  WorkspaceFileRecord,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { GET as downloadFileRoute } from '@/app/api/v2/files/[fileId]/route'
import { POST as createFileRoute } from '@/app/api/v2/files/route'
import { POST as executeRoute } from '@/app/api/v2/workflows/[workflowId]/execute/route'
import { getLatestBlock } from '@/blocks/registry'
import { DAGExecutor } from '@/executor/execution/executor'
import { Serializer } from '@/serializer'
import type { SerializedWorkflow } from '@/serializer/types'
import type { BlockState } from '@/stores/workflows/workflow/types'

const fixtures = vi.hoisted(() => ({
  files: new Map<string, { path: string; record: WorkspaceFileRecord }>(),
  workspaceId: 'csv-workspace',
  userId: 'csv-user',
  permission: 'admin' as PermissionType | null,
  reads: [] as string[],
  audiences: [] as string[],
  saved: new Map<string, ReturnType<typeof workflowState>>(),
  loaded: [] as string[],
  completed: [] as Array<Parameters<LoggingSession['safeComplete']>[0]>,
  pending: [] as Promise<void>[],
  upload: vi.fn<typeof uploadWorkspaceFile>(),
}))

const workspaceStorage = vi.hoisted(() => ({
  uploadWorkspaceFile: fixtures.upload,
  loadActiveWorkspaceContext: async (workspaceId: string) =>
    workspaceId === fixtures.workspaceId
      ? {
          workspaceId,
          workspaceOrganizationId: null,
          allowPersonalApiKeys: true,
          billedAccountUserId: fixtures.userId,
        }
      : null,
  loadActiveWorkspaceFileContext: async (fileId: string) =>
    fixtures.files.has(fileId)
      ? {
          fileId,
          workspaceId: fixtures.workspaceId,
          workspaceOrganizationId: null,
          allowPersonalApiKeys: true,
          billedAccountUserId: fixtures.userId,
        }
      : null,
  getWorkspaceFile: async (workspaceId: string, fileId: string) =>
    workspaceId === fixtures.workspaceId ? (fixtures.files.get(fileId)?.record ?? null) : null,
  fetchWorkspaceFileBuffer: async (file: WorkspaceFileRecord) => {
    const stored = fixtures.files.get(file.id)
    if (!stored || stored.record.key !== file.key) throw new Error('Missing local fixture file')
    fixtures.reads.push(file.id)
    return readFile(stored.path)
  },
}))

vi.unmock('@/tools/registry')
vi.unmock('@/blocks/registry')
vi.mock('@/lib/api/server/routes/v2-api-key-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/server/routes/v2-api-key-auth')>()),
  authenticateV2ApiKey: async () => ({
    principal: { kind: 'personal_api_key', userId: fixtures.userId, keyId: 'csv-key' },
    rateLimitSubjectIds: ['user:csv-user'],
    rateLimitSubscription: null,
    keyType: 'personal',
    keyExpiresAt: null,
  }),
}))
vi.mock('@/lib/core/rate-limiter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/core/rate-limiter')>()),
  getRateLimit: () => ({ maxTokens: 100, refillRate: 50, refillIntervalMs: 60_000 }),
  RateLimiter: class {
    async checkRateLimitDirect() {
      return { allowed: true, remaining: 99, resetAt: new Date() }
    }
    async checkRateLimitDirectOrThrow() {
      return { allowed: true, remaining: 99, resetAt: new Date() }
    }
  },
}))
vi.mock('@/lib/workflows/application/context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/workflows/application/context')>()),
  resolveActiveWorkflowApplicationContext: async ({ workflowId }: { workflowId: string }) => ({
    workflowId,
    workspaceId: fixtures.workspaceId,
    workspaceOrganizationId: null,
    allowPersonalApiKeys: true,
    billedAccountUserId: fixtures.userId,
    workflow: {
      id: workflowId,
      userId: fixtures.userId,
      workspaceId: fixtures.workspaceId,
      variables: {},
      isDeployed: false,
    },
  }),
}))
vi.mock('@/lib/workflows/persistence/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/workflows/persistence/utils')>()),
  loadWorkflowFromNormalizedTables: async (workflowId: string) => {
    fixtures.loaded.push(workflowId)
    return structuredClone(fixtures.saved.get(workflowId) ?? null)
  },
  loadDeployedWorkflowState: async () => {
    throw new Error('This fixture has no deployed version')
  },
}))
vi.mock('@/lib/execution/preprocessing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/execution/preprocessing')>()),
  preprocessExecution: async ({ workflowId }: { workflowId: string }) => ({
    success: true,
    actorUserId: fixtures.userId,
    workflowRecord: {
      id: workflowId,
      userId: fixtures.userId,
      workspaceId: fixtures.workspaceId,
      variables: {},
      isDeployed: false,
    },
    actorSubscription: { plan: 'pro' },
    billingAttribution: {
      actorUserId: fixtures.userId,
      workspaceId: fixtures.workspaceId,
      organizationId: null,
      billedAccountUserId: fixtures.userId,
      billingEntity: { type: 'user', id: fixtures.userId },
      billingPeriod: { start: '2026-09-01T00:00:00.000Z', end: '2026-10-01T00:00:00.000Z' },
      payerSubscription: null,
    },
    executionTimeout: { sync: 20_000, async: 20_000 },
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
  claimExecutionId: async (executionId: string) => ({ key: executionId, token: executionId }),
  hasDurableExecutionOwner: async () => true,
  releaseExecutionIdClaim: async () => {},
}))
vi.mock('@/lib/workflows/executor/human-in-the-loop-manager', () => ({
  PauseResumeManager: { processQueuedResumes: async () => {} },
}))
vi.mock('@/lib/logs/execution/logging-session', () => ({
  LoggingSession: class {
    setExecutionDeadlineAt() {}
    setResolvedSecretTraceRegistry() {}
    setTraceLargeValueAccess() {}
    async safeStart() {
      return true
    }
    async onBlockStart() {}
    async onBlockComplete() {}
    async safeComplete(input: Parameters<LoggingSession['safeComplete']>[0]) {
      fixtures.completed.push(input)
    }
    async safeCompleteWithError() {}
    hasCompleted() {
      return true
    }
    setPostExecutionPromise(promise: Promise<void>) {
      fixtures.pending.push(promise)
    }
    projectDiagnosticError() {
      return {}
    }
  },
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
vi.mock('@/lib/public-shares/share-manager', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/public-shares/share-manager')>()),
  getShareForResource: async () => null,
}))
vi.mock('@sim/platform-authz/workspace', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@sim/platform-authz/workspace')>()),
  resolveEffectiveWorkspacePermission: vi.fn(async () => fixtures.permission),
}))
vi.mock('@/lib/workspaces/application/workspace-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/workspaces/application/workspace-context')>()),
  resolveActiveWorkspaceApplicationContext: async (workspaceId: string) => ({
    workspaceId,
    workspaceOrganizationId: null,
    allowPersonalApiKeys: true,
    billedAccountUserId: fixtures.userId,
  }),
}))
vi.mock('@/lib/internal/principals/executor', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/internal/principals/executor')>()),
  createExecutorPrincipalFromExecutionContext: async ({
    audience,
    context,
  }: CreateExecutorPrincipalFromExecutionContextInput): Promise<DelegatedPrincipal> => {
    if (!context.workspaceId) throw new Error('Fixture execution requires a workspace')
    fixtures.audiences.push(audience)
    return {
      kind: 'delegated',
      serviceId: 'executor',
      subjectUserId: fixtures.userId,
      workspaceId: context.workspaceId,
      delegationId: 'csv-test',
      audience,
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      resourceScope: { executionId: context.executionId },
    }
  },
}))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/lib/uploads/contexts/workspace/workspace-file-manager')
  >()),
  ...workspaceStorage,
}))
vi.mock('@/lib/uploads/contexts/workspace', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/uploads/contexts/workspace')>()),
  ...workspaceStorage,
}))
vi.mock('@/lib/uploads/core/storage-service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/uploads/core/storage-service')>()),
  downloadFileStream: async ({ key }: { key: string }) => {
    const stored = [...fixtures.files.values()].find((entry) => entry.record.key === key)
    if (!stored) throw new Error('Missing fixture download')
    fixtures.reads.push(stored.record.id)
    return createReadStream(stored.path)
  },
}))
vi.mock('@/lib/users/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/users/queries')>()),
  getUserEmailsByIds: async (ids: readonly string[]) =>
    new Map(ids.map((id) => [id, 'csv@example.test'])),
}))
vi.mock('@/lib/uploads/server/metadata', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/uploads/server/metadata')>()),
  getFileMetadataByKey: async (key: string) =>
    [...fixtures.files.values()].find((file) => file.record.key === key)?.record ?? null,
}))
vi.mock('@/lib/uploads/utils/file-utils.server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/uploads/utils/file-utils.server')>()),
  downloadServableFileFromStorage: async (file: { key: string }) => {
    const stored = [...fixtures.files.values()].find((entry) => entry.record.key === file.key)
    if (!stored) throw new Error('Missing local fixture bytes')
    fixtures.reads.push(stored.record.id)
    return { buffer: await readFile(stored.path) }
  },
}))

function workflowState(code: string) {
  const fileBlock = getLatestBlock('file')
  if (!fileBlock) throw new Error('File block is not registered')
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
          value: JSON.stringify([{ name: 'file_id', type: 'string' }]),
        },
      },
      outputs: { file_id: { type: 'string' } },
    },
    file: {
      id: 'file',
      type: fileBlock.type,
      name: 'Read file',
      position: { x: 0, y: 100 },
      enabled: true,
      advancedMode: true,
      subBlocks: {
        operation: { id: 'operation', type: 'dropdown', value: 'file_read' },
        readFileId: { id: 'readFileId', type: 'short-input', value: '<start.file_id>' },
      },
      outputs: fileBlock.outputs,
    },
    summarize: {
      id: 'summarize',
      type: 'function',
      name: 'Summarize',
      position: { x: 0, y: 200 },
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
    edges: [
      { id: 'start-file', source: 'start', target: 'file' },
      { id: 'file-summarize', source: 'file', target: 'summarize' },
    ],
    loops: {},
    parallels: {},
  }
}

function workflow(code: string): SerializedWorkflow {
  const state = workflowState(code)
  return new Serializer().serializeWorkflow(
    state.blocks,
    state.edges,
    state.loops,
    state.parallels,
    true
  )
}

function execute(saved: SerializedWorkflow, fileId: string, workspaceId = fixtures.workspaceId) {
  const executionId = generateId()
  return new DAGExecutor({
    workflow: saved,
    workflowInput: { file_id: fileId },
    contextExtensions: {
      workspaceId,
      userId: fixtures.userId,
      executionId,
      executorDelegationOrigin: {
        workflowId: 'csv-workflow',
        executionId,
        subjectUserId: fixtures.userId,
      },
    },
  }).execute('csv-workflow')
}

function cliIdentity(workflowId: string): EmbeddedCliIdentity {
  return {
    endpoint: 'https://sim.test',
    apiKey: 'csv-key',
    workspaceId: fixtures.workspaceId,
    transport: async (url, init) => {
      const request = new NextRequest(new Request(url, init))
      const pathname = request.nextUrl.pathname
      expect(request.headers.get('x-api-key')).toBe('csv-key')
      if (pathname === `/api/v2/workflows/${workflowId}/execute`) {
        return executeRoute(request, { params: Promise.resolve({ workflowId }) })
      }
      if (pathname === '/api/v2/files' && request.method === 'POST') return createFileRoute(request)
      const fileId = pathname.match(/^\/api\/v2\/files\/([^/]+)$/)?.[1]
      if (fileId && request.method === 'GET')
        return downloadFileRoute(request, { params: Promise.resolve({ fileId }) })
      throw new Error(`Unexpected fixture request: ${request.method} ${pathname}`)
    },
  }
}

function runSavedCsv(workflowId: string, fileId: string) {
  return runCli(
    ['workflows', 'run', workflowId, '--manual', '--input', JSON.stringify({ file_id: fileId })],
    cliIdentity(workflowId),
    null
  )
}

const csvHeader = 'order_id,customer_id,region,amount,status,order_date'
const inputs = [
  {
    name: 'original.csv',
    content: `${csvHeader}\na,client,west,10.50,paid,2026-09-01\nb,client,east,2.50,pending,2026-09-02\nc,client,west,90,cancelled,2026-09-03\na,client,west,999,paid,2026-09-04\n`,
    expected: {
      source_rows: 4,
      accepted_rows: 2,
      cancelled_rows: 1,
      regions: [
        { region: 'east', total_amount: '2.50' },
        { region: 'west', total_amount: '10.50' },
      ],
      rejected: [{ row_number: 4, order_id: 'a', reason: 'duplicate' }],
    },
  },
  {
    name: 'changed.csv',
    content: [
      csvHeader,
      'a,"client,""one""",west,0.10,pending,2024-02-29',
      'b,client,west,0.20,paid,2026-01-01',
      'c,client,"north, retail",0,paid,2026-01-01',
      'd,client,"east\ncoast",00012.3,paid,2026-01-01',
      'e,client,west,,cancelled,2026-01-01',
      'e,client,west,900,paid,2026-01-01',
      'f,client,west,1,cancelled,2026-02-29',
      'f,client,west,1,paid,2026-03-01',
      'g,client,west,2.005,paid,2026-01-01',
      'h,client,west,1e2,paid,2026-01-01',
      'i,client,west,-1,paid,2026-01-01',
      'j,client,west,999,cancelled,2026-01-01',
      'a,client,west,10000,cancelled,2026-01-01',
    ].join('\r\n'),
    expected: {
      source_rows: 13,
      accepted_rows: 4,
      cancelled_rows: 1,
      regions: [
        { region: 'east\ncoast', total_amount: '12.30' },
        { region: 'north, retail', total_amount: '0.00' },
        { region: 'west', total_amount: '0.30' },
      ],
      rejected: [
        { row_number: 5, order_id: 'e', reason: 'invalid_amount' },
        { row_number: 6, order_id: 'e', reason: 'duplicate' },
        { row_number: 7, order_id: 'f', reason: 'invalid_date' },
        { row_number: 8, order_id: 'f', reason: 'duplicate' },
        { row_number: 9, order_id: 'g', reason: 'invalid_amount' },
        { row_number: 10, order_id: 'h', reason: 'invalid_amount' },
        { row_number: 11, order_id: 'i', reason: 'invalid_amount' },
        { row_number: 13, order_id: 'a', reason: 'duplicate' },
      ],
    },
  },
  {
    name: 'empty.csv',
    content: csvHeader,
    expected: { source_rows: 0, accepted_rows: 0, cancelled_rows: 0, regions: [], rejected: [] },
  },
]

const smokeEnabled = process.env.SIM_HELPERS_SMOKE === '1'
describe.skipIf(!smokeEnabled)(
  'Mothership CSV composition in the real DAG and JavaScript runtime',
  () => {
    let directory: string
    let fileId: string
    let program: string
    const csvFileIds: string[] = []
    async function storeFile(name: string, content: string, contentType = 'text/csv') {
      const id = generateId()
      const path = join(directory, name)
      await writeFile(path, content)
      const now = new Date()
      fixtures.files.set(id, {
        path,
        record: {
          id,
          workspaceId: fixtures.workspaceId,
          name,
          key: `workspace/${fixtures.workspaceId}/${id}/${name}`,
          path: `/api/files/serve/${id}`,
          size: Buffer.byteLength(content),
          type: contentType,
          uploadedBy: fixtures.userId,
          uploadedAt: now,
          updatedAt: now,
          contentUpdatedAt: now,
        },
      })
      return id
    }
    beforeAll(async () => {
      directory = await mkdtemp(join(tmpdir(), 'mship-csv-execution-'))
      fileId = await storeFile('orders.csv', 'order_id,amount\na,0.10\nb,0.20\n')
      program = await readFile(
        new URL('./csv-workflow-program.fixture.txt', import.meta.url),
        'utf8'
      )
      for (const input of inputs) csvFileIds.push(await storeFile(input.name, input.content))
      fixtures.upload.mockImplementation(async (workspaceId, userId, buffer, name, type) => {
        expect(workspaceId).toBe(fixtures.workspaceId)
        expect(userId).toBe(fixtures.userId)
        const id = await storeFile(name, buffer.toString('utf8'), type)
        const stored = fixtures.files.get(id)
        if (!stored) throw new Error('Fixture upload did not create a file')
        return {
          ...stored.record,
          url: `https://sim.test/api/v2/files/${id}`,
          context: 'workspace',
          folderId: null,
          folderPath: null,
          deletedAt: null,
        }
      })
    })
    beforeEach(() => {
      vi.clearAllMocks()
      fixtures.saved.clear()
      fixtures.loaded.length = 0
      fixtures.completed.length = 0
      fixtures.pending.length = 0
      fixtures.reads.length = 0
      fixtures.audiences.length = 0
      fixtures.permission = 'admin'
    })
    afterAll(async () => {
      fixtures.files.clear()
      await rm(directory, { recursive: true, force: true })
    })
    it('passes a file object through graph references and reads its actual bytes inside the function', async () => {
      const result = await execute(
        workflow('return await sim.files.readText(<readfile.files[0]>);'),
        fileId
      )
      expect(result.success, JSON.stringify(result)).toBe(true)
      expect(result.output).toEqual(
        expect.objectContaining({ result: 'order_id,amount\na,0.10\nb,0.20\n' })
      )
      expect(fixtures.reads).toContain(fileId)
    }, 30_000)
    it('executes the same serialized CSV program for changed, empty and original file IDs', async () => {
      const saved = workflow(program)
      const before = structuredClone(saved)
      for (const index of [1, 2, 0]) {
        const result = await execute(saved, csvFileIds[index])
        expect(result.success).toBe(true)
        expect(result.output).toEqual(expect.objectContaining({ result: inputs[index].expected }))
        expect(fixtures.reads.at(-1)).toBe(csvFileIds[index])
      }
      expect(saved).toEqual(before)
      for (const [index, id] of csvFileIds.entries()) {
        const stored = fixtures.files.get(id)
        if (!stored) throw new Error('Source fixture was removed')
        expect(await readFile(stored.path, 'utf8')).toBe(inputs[index].content)
      }
      expect(fixtures.audiences).toContain('sim:workspace-files')
      expect(fixtures.audiences).toContain(FUNCTION_EXECUTION_DELEGATION_AUDIENCE)
      expect(executeInSandbox).not.toHaveBeenCalled()
      expect(executeShellInSandbox).not.toHaveBeenCalled()
    }, 30_000)
    it('rejects a caller whose current workspace membership has been removed before reading bytes', async () => {
      fixtures.permission = null
      await expect(execute(workflow(program), fileId)).rejects.toThrow(/workspace/i)
      expect(fixtures.reads).toEqual([])
    }, 30_000)
    it('rejects a missing file before executing the summary', async () => {
      await expect(execute(workflow(program), generateId())).rejects.toThrow(/File not found/i)
      expect(fixtures.reads).toEqual([])
    }, 30_000)
    it('rejects a file belonging to another asserted workspace before reading bytes', async () => {
      await expect(execute(workflow(program), fileId, 'another-workspace')).rejects.toThrow(
        /File not found/i
      )
      expect(fixtures.reads).toEqual([])
    }, 30_000)
    it('runs saved CSV state through the CLI and publishes the returned summary through file routes', async () => {
      const workflowId = generateId()
      const saved = workflowState(program)
      fixtures.saved.set(workflowId, structuredClone(saved))
      const identity = cliIdentity(workflowId)
      let reportContent: string | undefined
      const runIds = new Set<string>()
      for (const index of [1, 2, 0]) {
        const result = await runSavedCsv(workflowId, csvFileIds[index])
        await Promise.all(fixtures.pending)
        expect(result.exitCode, JSON.stringify(result)).toBe(0)
        const run = v2ExecuteWorkflowDataSchema.parse(JSON.parse(result.stdout))
        expect(run).toEqual(
          expect.objectContaining({
            workflowId,
            status: 'completed',
            error: null,
            output: expect.objectContaining({ result: inputs[index].expected }),
          })
        )
        expect(fixtures.completed.at(-1)).toEqual(
          expect.objectContaining({
            workflowInput: { file_id: csvFileIds[index] },
            finalOutput: expect.objectContaining({ result: inputs[index].expected }),
          })
        )
        runIds.add(run.runId)
        reportContent = JSON.stringify(z.object({ result: z.json() }).parse(run.output).result)
      }
      if (!reportContent) throw new Error('No execution result to publish')
      expect(runIds.size).toBe(3)
      expect(fixtures.loaded).toContain(workflowId)
      expect(fixtures.completed).toHaveLength(3)
      expect(fixtures.saved.get(workflowId)).toEqual(saved)
      const created = await runCli(
        ['files', 'create', '--name', `${workflowId}-summary.json`, '--content', reportContent],
        identity,
        null
      )
      expect(created.exitCode, JSON.stringify(created)).toBe(0)
      const report = v2FileSchema.parse(JSON.parse(created.stdout))
      const downloaded = await runCli(['files', 'get', report.id], identity, null)
      expect(downloaded.exitCode, JSON.stringify(downloaded)).toBe(0)
      expect(JSON.parse(downloaded.stdout)).toEqual(inputs[0].expected)
      const stored = fixtures.files.get(report.id)
      if (!stored) throw new Error('Published report is missing')
      expect(await readFile(stored.path, 'utf8')).toBe(reportContent)
      for (const [index, id] of csvFileIds.entries()) {
        const source = fixtures.files.get(id)
        if (!source) throw new Error('Source file was removed during publication')
        expect(await readFile(source.path, 'utf8')).toBe(inputs[index].content)
      }
      expect(executeInSandbox).not.toHaveBeenCalled()
      expect(executeShellInSandbox).not.toHaveBeenCalled()
    }, 30_000)
    it('returns a real Function failure as a failed CLI run with its run identity and error', async () => {
      const workflowId = generateId()
      fixtures.saved.set(workflowId, workflowState(program))
      const result = await runSavedCsv(workflowId, fileId)
      await Promise.all(fixtures.pending)
      expect(result.exitCode).toBe(1)
      const run = v2ExecuteWorkflowDataSchema.parse(JSON.parse(result.stdout))
      expect(run).toEqual(
        expect.objectContaining({
          workflowId,
          status: 'failed',
          error: expect.objectContaining({
            message: expect.stringContaining('Unexpected CSV header'),
            blockId: 'summarize',
          }),
        })
      )
      expect(result.stderr).toContain('Unexpected CSV header')
      expect(fixtures.upload).not.toHaveBeenCalled()
    }, 30_000)
    it('rechecks current access at report creation after a successful run', async () => {
      const workflowId = generateId()
      fixtures.saved.set(workflowId, workflowState(program))
      const result = await runSavedCsv(workflowId, csvFileIds[0])
      await Promise.all(fixtures.pending)
      expect(result.exitCode, JSON.stringify(result)).toBe(0)
      const run = v2ExecuteWorkflowDataSchema.parse(JSON.parse(result.stdout))
      const summary = z.object({ result: z.json() }).parse(run.output).result
      const initialFileCount = fixtures.files.size
      fixtures.permission = null
      const created = await runCli(
        [
          'files',
          'create',
          '--name',
          `${workflowId}-summary.json`,
          '--content',
          JSON.stringify(summary),
        ],
        cliIdentity(workflowId),
        null
      )
      expect(created.exitCode).toBe(1)
      expect(created.stderr).toContain('FORBIDDEN')
      expect(fixtures.upload).not.toHaveBeenCalled()
      expect(fixtures.files.size).toBe(initialFileCount)
    }, 30_000)
  }
)
