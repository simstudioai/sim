/**
 * @vitest-environment node
 *
 * Enable with SIM_HELPERS_SMOKE=1 and the installed Node isolated-vm runtime.
 * Real registry, serialization, DAG, tool dispatch, application authorization,
 * Function worker and file broker; fixture membership, delegation minting, metadata,
 * shares and disk storage. Remote compute is rejected. This does not exercise CLI
 * ingress, persisted workflow loading, real identity records or cloud storage.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DelegatedPrincipal } from '@sim/auth/principal'
import type { PermissionType } from '@sim/platform-authz/workspace'
import { generateId } from '@sim/utils/id'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { executeInSandbox, executeShellInSandbox } from '@/lib/execution/remote-sandbox'
import { FUNCTION_EXECUTION_DELEGATION_AUDIENCE } from '@/lib/function-execution/application/authorization'
import type { CreateExecutorPrincipalFromExecutionContextInput } from '@/lib/internal/principals/executor'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
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
}))

vi.unmock('@/tools/registry')
vi.unmock('@/blocks/registry')
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

function workflow(code: string): SerializedWorkflow {
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
  return new Serializer().serializeWorkflow(
    blocks,
    [
      { id: 'start-file', source: 'start', target: 'file' },
      { id: 'file-summarize', source: 'file', target: 'summarize' },
    ],
    {},
    {},
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
    async function storeFile(name: string, content: string) {
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
          type: 'text/csv',
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
    })
    beforeEach(() => {
      vi.clearAllMocks()
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
  }
)
