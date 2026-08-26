/**
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs'
import { Command } from 'commander'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { V2_OPERATIONS } from '../generated/v2-api'
import { SimApiError } from '../http/client'
import { BULK_OUTCOME_CHECKS, executeOperation } from './execute'
import type { OperationSpec } from './types'

const { request } = vi.hoisted(() => ({ request: vi.fn() }))

vi.mock('../context', () => ({
  clientFrom: () => ({
    client: { request, requireWorkspace: () => 'ws_local' },
    profile: {
      workspaceId: 'ws_local',
      output: 'json',
      name: 'default',
      apiKey: 'k',
      endpoint: 'https://sim.example',
    },
  }),
}))

const EXECUTE_WORKFLOW: OperationSpec = {
  method: 'POST',
  path: '/api/v2/workflows/[workflowId]/execute',
  pathParams: ['workflowId'],
  body: {},
}

/**
 * One of the many operations that merely *report* something with a status of its
 * own. Reading it back has succeeded whatever the record says, so the reported
 * status must not reach the exit code — branching on a run's status is what
 * `runs wait` is for, with its own exit-code matrix.
 */
const GET_WORKFLOW_DEPLOYMENT: OperationSpec = {
  method: 'GET',
  path: '/api/v2/workflows/[workflowId]/deployment',
  pathParams: ['workflowId'],
}

const BULK_DELETE_TABLES: OperationSpec = {
  method: 'POST',
  path: '/api/v2/tables/bulk-delete',
  pathParams: [],
  body: {},
}

const BULK_DELETE_FILES: OperationSpec = {
  method: 'POST',
  path: '/api/v2/files/bulk-delete',
  pathParams: [],
  body: { fileIds: { kind: 'array' } },
}

const MOVE_TABLES: OperationSpec = {
  method: 'POST',
  path: '/api/v2/tables/move',
  pathParams: [],
  body: {},
}

const MOVE_WORKFLOWS: OperationSpec = {
  method: 'POST',
  path: '/api/v2/workflows/move',
  pathParams: [],
  body: {},
}

const MOVE_FLAGS = { workflow: ['wf_1'], to: '/a' }

/** Invokes a generated command that takes its input from flags rather than positionals. */
function invokeWithFlags(
  operation: 'bulkDeleteTables' | 'bulkDeleteFiles' | 'moveTables' | 'moveWorkflows',
  spec: OperationSpec,
  flags: Record<string, unknown>
) {
  const host = new Command('leaf')
  return executeOperation(operation, {}, spec, [flags, host])
}

/** Invokes a generated command the way Commander would, with its positionals. */
function invoke(
  operation: 'executeWorkflow' | 'getWorkflowDeployment' | 'bulkDeleteTables',
  spec: OperationSpec,
  ...positional: string[]
) {
  const host = new Command('leaf')
  return executeOperation(operation, {}, spec, [...positional, {}, host])
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('an in-band run failure', () => {
  it('fails the process when a synchronous run reports status failed', async () => {
    request.mockResolvedValue({
      data: {
        runId: 'run_1',
        status: 'failed',
        error: { code: 'BLOCK_EXECUTION_FAILED', message: 'doubler threw' },
      },
    })

    await expect(invoke('executeWorkflow', EXECUTE_WORKFLOW, 'wf_1')).rejects.toThrow(
      /doubler threw/
    )
  })

  it('fails the process when a synchronous run reports status cancelled', async () => {
    request.mockResolvedValue({ data: { runId: 'run_1', status: 'cancelled', error: null } })

    await expect(invoke('executeWorkflow', EXECUTE_WORKFLOW, 'wf_1')).rejects.toThrow(SimApiError)
  })

  it('succeeds when the run completed', async () => {
    request.mockResolvedValue({ data: { runId: 'run_1', status: 'completed', error: null } })

    await expect(invoke('executeWorkflow', EXECUTE_WORKFLOW, 'wf_1')).resolves.toBeUndefined()
  })

  /**
   * `paused` is a run waiting to be resumed, not a broken one, and `--follow`
   * reports it the way it reports a success.
   */
  it('succeeds when the run is paused', async () => {
    request.mockResolvedValue({ data: { runId: 'run_1', status: 'paused', error: null } })

    await expect(invoke('executeWorkflow', EXECUTE_WORKFLOW, 'wf_1')).resolves.toBeUndefined()
  })

  /**
   * The scoping guard. A command that reports a failed *record* has itself
   * succeeded, and reading any `status` field in any payload as the command's
   * own outcome would start failing every one of them.
   */
  it('leaves an unrelated operation reporting a failed record alone', async () => {
    request.mockResolvedValue({
      data: { id: 'dep_1', status: 'failed', error: { message: 'the deployment failed' } },
    })

    await expect(
      invoke('getWorkflowDeployment', GET_WORKFLOW_DEPLOYMENT, 'wf_1')
    ).resolves.toBeUndefined()
  })
})

describe('a bulk call that changed nothing', () => {
  it('fails the process when every requested table was missing', async () => {
    request.mockResolvedValue({
      data: {
        deleted: [],
        skipped: [],
        notFound: [
          { kind: 'table', id: 'tbl_nope1' },
          { kind: 'table', id: 'tbl_nope2' },
        ],
        failed: [],
        deletedItems: { tables: 0, folders: 0 },
      },
    })

    await expect(invokeWithFlags('bulkDeleteTables', BULK_DELETE_TABLES, {})).rejects.toThrow(
      /Deleted nothing/
    )
  })

  it('fails the process when every requested table could not be deleted', async () => {
    request.mockResolvedValue({
      data: {
        deleted: [],
        skipped: [],
        notFound: [],
        failed: [{ kind: 'table', id: 'tbl_1', name: 't', reason: 'locked' }],
        deletedItems: { tables: 0, folders: 0 },
      },
    })

    await expect(invokeWithFlags('bulkDeleteTables', BULK_DELETE_TABLES, {})).rejects.toThrow(
      SimApiError
    )
  })

  /**
   * The scoping guard. Some items really were deleted, so the call did work;
   * failing here would break every caller sweeping a list that legitimately
   * contains already-gone ids.
   */
  it('succeeds on a partial delete', async () => {
    request.mockResolvedValue({
      data: {
        deleted: [{ kind: 'table', id: 'tbl_1', name: 't' }],
        skipped: [],
        notFound: [{ kind: 'table', id: 'tbl_nope' }],
        failed: [],
        deletedItems: { tables: 1, folders: 0 },
      },
    })

    await expect(
      invokeWithFlags('bulkDeleteTables', BULK_DELETE_TABLES, {})
    ).resolves.toBeUndefined()
  })

  /** A folder-only delete still deleted something. */
  it('succeeds when only folders were deleted', async () => {
    request.mockResolvedValue({
      data: {
        deleted: [{ kind: 'folder', id: 'fld_1', name: 'f' }],
        skipped: [],
        notFound: [],
        failed: [],
        deletedItems: { tables: 0, folders: 1 },
      },
    })

    await expect(
      invokeWithFlags('bulkDeleteTables', BULK_DELETE_TABLES, {})
    ).resolves.toBeUndefined()
  })

  /** Nothing asked for, nothing missed: an empty sweep is not a failure. */
  it('succeeds when nothing was requested', async () => {
    request.mockResolvedValue({
      data: {
        deleted: [],
        skipped: [],
        notFound: [],
        failed: [],
        deletedItems: { tables: 0, folders: 0 },
      },
    })

    await expect(
      invokeWithFlags('bulkDeleteTables', BULK_DELETE_TABLES, {})
    ).resolves.toBeUndefined()
  })

  it('fails the process when every workflow move failed', async () => {
    request.mockResolvedValue({ data: { moved: [], failed: ['wf_1'], folderPath: '/a' } })

    await expect(invokeWithFlags('moveWorkflows', MOVE_WORKFLOWS, MOVE_FLAGS)).rejects.toThrow(
      /Moved nothing/
    )
  })

  it('succeeds on a partial move', async () => {
    request.mockResolvedValue({ data: { moved: ['wf_1'], failed: ['wf_2'], folderPath: '/a' } })

    await expect(
      invokeWithFlags('moveWorkflows', MOVE_WORKFLOWS, MOVE_FLAGS)
    ).resolves.toBeUndefined()
  })

  it('succeeds when every workflow moved', async () => {
    request.mockResolvedValue({ data: { moved: ['wf_1'], failed: [], folderPath: '/a' } })

    await expect(
      invokeWithFlags('moveWorkflows', MOVE_WORKFLOWS, MOVE_FLAGS)
    ).resolves.toBeUndefined()
  })

  /**
   * `bulkDeleteFiles` reports a deleted count and nothing else, so the number of
   * items asked for is only knowable from the request that was sent.
   */
  it('fails the process when no requested file was deleted', async () => {
    request.mockResolvedValue({ data: { deletedItems: { files: 0 } } })

    await expect(
      invokeWithFlags('bulkDeleteFiles', BULK_DELETE_FILES, { fileIds: ['file_1', 'file_2'] })
    ).rejects.toThrow(/Deleted nothing/)
  })

  it('succeeds on a partial file delete', async () => {
    request.mockResolvedValue({ data: { deletedItems: { files: 1 } } })

    await expect(
      invokeWithFlags('bulkDeleteFiles', BULK_DELETE_FILES, { fileIds: ['file_1', 'file_2'] })
    ).resolves.toBeUndefined()
  })

  it('fails the process when every table move failed', async () => {
    request.mockResolvedValue({
      data: {
        moved: [],
        skipped: [],
        notFound: [],
        failed: [{ kind: 'table', id: 'tbl_1', name: 't', reason: 'locked' }],
      },
    })

    await expect(invokeWithFlags('moveTables', MOVE_TABLES, {})).rejects.toThrow(/Moved nothing/)
  })

  /**
   * A move reports an id nothing resolved to under `notFound`, leaving `failed`
   * empty — so a check reading `failed` alone exited `0` on a batch of typos,
   * the exact case it exists to catch.
   */
  it('fails the process when every table to move was missing', async () => {
    request.mockResolvedValue({
      data: {
        moved: [],
        skipped: [],
        notFound: [
          { kind: 'table', id: 'tbl_nope1' },
          { kind: 'table', id: 'tbl_nope2' },
        ],
        failed: [],
      },
    })

    await expect(invokeWithFlags('moveTables', MOVE_TABLES, {})).rejects.toThrow(
      /Moved nothing: 2 of 2 items were not found or could not be moved\./
    )
  })

  it('succeeds on a partial table move', async () => {
    request.mockResolvedValue({
      data: {
        moved: [{ kind: 'table', id: 'tbl_1', name: 't' }],
        skipped: [],
        notFound: [],
        failed: [{ kind: 'table', id: 'tbl_2', name: 'u', reason: 'locked' }],
      },
    })

    await expect(invokeWithFlags('moveTables', MOVE_TABLES, {})).resolves.toBeUndefined()
  })

  it('succeeds when no table was requested', async () => {
    request.mockResolvedValue({ data: { moved: [], skipped: [], notFound: [], failed: [] } })

    await expect(invokeWithFlags('moveTables', MOVE_TABLES, {})).resolves.toBeUndefined()
  })
})

/**
 * Response shapes that report a bulk outcome in the payload rather than in the
 * status code, and are deliberately left unchecked.
 *
 * A single-folder delete confirms itself with `deleted: true`; its
 * `deletedItems` counts are the contents that went with the folder, and an
 * empty folder legitimately deletes nothing.
 */
const UNCHECKED_BULK_OUTCOMES: ReadonlySet<string> = new Set([
  'deleteFileFolder',
  'deleteKnowledgeFolder',
  'deleteTableFolder',
  'deleteWorkflowFolder',
])

/** The generated response type declarations for one operation, as source text. */
function responseTypeSource(source: string, operation: string): string {
  const pascal = operation.charAt(0).toUpperCase() + operation.slice(1)
  const pattern = new RegExp(
    `^(?:export )?type ${pascal}Response(?:Ref\\d+)? = \\{$[\\s\\S]*?^\\}$`,
    'gm'
  )
  return (source.match(pattern) ?? []).join('\n')
}

describe('the bulk-outcome check covers every operation shaped like one', () => {
  /**
   * The two operations this check was written for had two siblings with the
   * identical defect that nobody noticed, because nothing tied the shape to the
   * check. An operation that reports what it touched in the payload must either
   * be checked or be listed above as deliberately exempt.
   */
  it('has an entry, or an exemption, for every payload-reported outcome', () => {
    const source = readFileSync(new URL('../generated/v2-api.ts', import.meta.url).pathname, 'utf8')

    const shaped = Object.keys(V2_OPERATIONS).filter((operation) => {
      const declared = responseTypeSource(source, operation)
      if (/^\s+deletedItems\s*:/m.test(declared)) return true
      return /^\s+moved\s*:/m.test(declared) && /^\s+failed\s*:/m.test(declared)
    })

    expect(shaped.length).toBeGreaterThan(0)
    for (const operation of shaped) {
      if (UNCHECKED_BULK_OUTCOMES.has(operation)) continue
      expect(Object.keys(BULK_OUTCOME_CHECKS)).toContain(operation)
    }
  })
})
