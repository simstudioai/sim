import { readFileSync } from 'node:fs'
import { Command } from 'commander'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CLI_CONTRACT } from '../contract/commands'
import {
  type CreateWorkspaceInvitationsResponse,
  type GetWorkspaceOperationResponse,
  V2_OPERATIONS,
} from '../generated/v2-api'
import { SimApiError } from '../http/client'
import { BULK_OUTCOME_CHECKS, executeOperation } from './execute'
import type { OperationSpec } from './types'

const { request, output } = vi.hoisted(() => ({ request: vi.fn(), output: { format: 'json' } }))

vi.mock('../context', () => ({
  clientFrom: () => ({
    client: { request, requireWorkspace: () => 'ws_local' },
    profile: {
      workspaceId: 'ws_local',
      output: output.format,
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
const _GET_WORKFLOW_DEPLOYMENT: OperationSpec = {
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

const _BULK_DELETE_FILES: OperationSpec = {
  method: 'POST',
  path: '/api/v2/files/bulk-delete',
  pathParams: [],
  body: { fileIds: { kind: 'array' } },
}

const _MOVE_TABLES: OperationSpec = {
  method: 'POST',
  path: '/api/v2/tables/move',
  pathParams: [],
  body: {},
}

const _MOVE_WORKFLOWS: OperationSpec = {
  method: 'POST',
  path: '/api/v2/workflows/move',
  pathParams: [],
  body: {},
}

const _MOVE_FLAGS = { workflow: ['wf_1'], to: '/a' }

const DELETE_TABLE_ROWS: OperationSpec = {
  method: 'DELETE',
  path: '/api/v2/tables/[tableId]/rows',
  pathParams: ['tableId'],
  body: { rowIds: { kind: 'array' }, filter: { kind: 'unknown' } },
}

/** Invokes a generated command that takes both a path positional and flags. */
function _invokeRowDelete(flags: Record<string, unknown>) {
  const host = new Command('leaf')
  return executeOperation('deleteTableRows', {}, DELETE_TABLE_ROWS, ['tbl_1', flags, host])
}

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
  output.format = 'json'
})

const PUBLISH_CHAT: OperationSpec = {
  method: 'PUT',
  path: '/api/v2/workflows/[workflowId]/deployments/chat',
  pathParams: ['workflowId'],
  body: {},
}

const PUBLIC_NOTE =
  'note: auth type is public — anyone with the link can chat; pass --auth-type password|email to restrict it.'

/** Publishes a chat past its `--yes` gate with the required fields and the given extras. */
function publishChat(flags: Record<string, unknown>) {
  const host = new Command('leaf')
  return executeOperation(
    'replaceWorkflowChatDeployment',
    CLI_CONTRACT.replaceWorkflowChatDeployment ?? {},
    PUBLISH_CHAT,
    ['wf_1', { yes: true, identifier: 'support', title: 'Support', ...flags }, host]
  )
}

/** stdout and stderr as strings, captured separately so the note can be placed. */
function streams() {
  const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
  const stdout = vi.spyOn(console, 'log').mockImplementation(() => {})
  return {
    get stderr() {
      return stderr.mock.calls.map(([chunk]) => String(chunk)).join('')
    },
    get stdout() {
      return stdout.mock.calls.map((call) => call.map(String).join(' ')).join('\n')
    },
  }
}

describe('a chat publish that lands on public auth', () => {
  it('notes the exposure on stderr when the default chose public, and keeps stdout the record', async () => {
    request.mockResolvedValue({
      data: { id: 'chat_1', identifier: 'support', authType: 'public' },
    })
    const captured = streams()

    await publishChat({})

    expect(request.mock.calls[0][1].body).not.toHaveProperty('authType')
    expect(captured.stderr).toContain(PUBLIC_NOTE)
    expect(captured.stdout).not.toContain('note:')
    expect(JSON.parse(captured.stdout)).toEqual({
      id: 'chat_1',
      identifier: 'support',
      authType: 'public',
    })
  })
})

describe('workspace mutation receipt identity', () => {
  const receipt: GetWorkspaceOperationResponse['data'] = {
    operationId: 'operation-1',
    requestId: 'original-request',
    workspaceId: 'ws_local',
    kind: 'workspace_push',
    applied: true,
    status: 'completed',
    resourceIds: ['workflow-1'],
    issues: [],
  }
  const flags = {
    requestId: receipt.requestId,
    previewFingerprint: 'a'.repeat(64),
    otherWorkspaceId: 'ws_other',
    yes: true,
  }

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  function applyPush(wait: boolean) {
    return executeOperation(
      'pushWorkspace',
      CLI_CONTRACT.pushWorkspace!,
      V2_OPERATIONS.pushWorkspace,
      [{ ...flags, wait }, new Command('leaf')]
    )
  }

  it.each([
    { field: 'requestId', value: 'another-request', wait: false },
    { field: 'requestId', value: 'another-request', wait: true },
    { field: 'workspaceId', value: 'another-workspace', wait: false },
    { field: 'workspaceId', value: 'another-workspace', wait: true },
    { field: 'kind', value: 'workspace_pull', wait: false },
    { field: 'kind', value: 'workspace_pull', wait: true },
  ])(
    'refuses a mismatched $field with wait=$wait and retains submitted identity',
    async ({ field, value, wait }) => {
      request.mockResolvedValue({ data: { ...receipt, status: 'processing', [field]: value } })

      await expect(applyPush(wait)).rejects.toMatchObject({
        code: 'MUTATION_OUTCOME_UNKNOWN',
        details: { requestId: 'original-request', workspaceId: 'ws_local', applied: 'unknown' },
      })

      expect(request).toHaveBeenCalledTimes(1)
      expect(console.log).not.toHaveBeenCalled()
    }
  )

  it('retains submitted identity when the receipt is malformed', async () => {
    request.mockResolvedValue({ data: { applied: true, operationId: 'untrusted-operation' } })
    await expect(applyPush(true)).rejects.toMatchObject({
      code: 'MUTATION_OUTCOME_UNKNOWN',
      details: { requestId: 'original-request', workspaceId: 'ws_local', applied: 'unknown' },
    })
    expect(request).toHaveBeenCalledTimes(1)
    expect(console.log).not.toHaveBeenCalled()
  })
})

describe('selector pagination metadata', () => {
  it('preserves clipping reported by a later provider page in machine output', async () => {
    request
      .mockResolvedValueOnce({
        data: [{ id: 'first', label: 'First' }],
        nextCursor: 'next-page',
        truncated: false,
      })
      .mockResolvedValueOnce({
        data: [{ id: 'second', label: 'Second' }],
        nextCursor: null,
        truncated: true,
      })
    const stdout = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)

    await executeOperation('listSelector', CLI_CONTRACT.listSelector!, V2_OPERATIONS.listSelector, [
      { selectorKey: 'gmail.labels', context: '{"oauthCredential":"connection-1"}', limit: '0' },
      new Command('leaf'),
    ])

    expect(request).toHaveBeenCalledTimes(2)
    expect(JSON.parse(stdout.mock.calls[0][0])).toEqual({
      data: [
        { id: 'first', label: 'First' },
        { id: 'second', label: 'Second' },
      ],
      nextCursor: null,
      truncated: true,
    })
  })
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

  /**
   * `paused` is a run waiting to be resumed, not a broken one, and `--follow`
   * reports it the way it reports a success.
   */
  it('succeeds when the run is paused', async () => {
    request.mockResolvedValue({ data: { runId: 'run_1', status: 'paused', error: null } })

    await expect(invoke('executeWorkflow', EXECUTE_WORKFLOW, 'wf_1')).resolves.toBeUndefined()
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
})

const BULK_UPDATE_CHUNKS: OperationSpec = {
  method: 'PATCH',
  path: '/api/v2/knowledge/[knowledgeBaseId]/documents/[documentId]/chunks',
  pathParams: ['knowledgeBaseId', 'documentId'],
  body: {},
}

const ADD_WORKSPACE_FILES: OperationSpec = {
  method: 'POST',
  path: '/api/v2/knowledge/[knowledgeBaseId]/documents/from-workspace-files',
  pathParams: ['knowledgeBaseId'],
  body: {},
}

/**
 * Two more endpoints that answer `200` having done nothing at all: a chunk
 * update where no listed id matched, and an indexing call where every file
 * failed. Both printed their own report of the miss and exited `0`, so
 * `sim … && next-step` ran on the strength of a no-op.
 */
describe('workspace invitation batch outcomes', () => {
  const receipt = {
    id: 'invitation-1',
    email: 'first@example.com',
    workspaceIds: ['ws_local'],
    permission: 'read',
    membershipIntent: 'internal',
  } as const
  const empty: CreateWorkspaceInvitationsResponse['data'] = {
    success: true,
    successful: [],
    added: [],
    failed: [],
    invitations: [],
  }

  function invite() {
    return executeOperation(
      'createWorkspaceInvitations',
      CLI_CONTRACT.createWorkspaceInvitations!,
      V2_OPERATIONS.createWorkspaceInvitations,
      [{ emails: ['first@example.com', 'second@example.com'] }, new Command('leaf')]
    )
  }

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it.each([false, true])(
    'prints every result and exits nonzero on a partial=%s failure',
    async (partial) => {
      const payload = {
        ...empty,
        success: false,
        successful: partial ? ['first@example.com'] : [],
        invitations: partial ? [receipt] : [],
        failed: [{ email: 'second@example.com', error: 'Unable to invite this recipient' }],
      }
      request.mockResolvedValue({ data: payload })
      await expect(invite()).rejects.toThrow(
        'Invitation batch failed for 1 recipient. Successful results remain committed; inspect failed recipients before retrying.'
      )
      expect(JSON.parse(vi.mocked(console.log).mock.calls[0][0])).toEqual(payload)
      expect(request).toHaveBeenCalledTimes(1)
    }
  )

  it('preserves HTTP failures without reporting a successful batch or retrying', async () => {
    const failure = new SimApiError('Organization access denied', 403)
    request.mockRejectedValue(failure)
    await expect(invite()).rejects.toBe(failure)
    expect(console.log).not.toHaveBeenCalled()
    expect(request).toHaveBeenCalledTimes(1)
  })
})

describe('a bulk call that touched nothing', () => {
  function updateChunks(flags: Record<string, unknown>) {
    const host = new Command('leaf')
    return executeOperation('bulkUpdateKnowledgeChunks', {}, BULK_UPDATE_CHUNKS, [
      'kb_1',
      'doc_1',
      flags,
      host,
    ])
  }

  function _indexFiles(flags: Record<string, unknown>) {
    const host = new Command('leaf')
    return executeOperation('addWorkspaceFilesToKnowledgeBase', {}, ADD_WORKSPACE_FILES, [
      'kb_1',
      flags,
      host,
    ])
  }

  const CHUNK_FLAGS = { operation: 'disable', chunk: ['c1', 'c2'] }

  it('fails the process when no listed chunk matched', async () => {
    request.mockResolvedValue({
      data: {
        operation: 'disable',
        processed: 0,
        errors: ['No matching chunks found to disable: c1, c2'],
      },
    })

    await expect(updateChunks(CHUNK_FLAGS)).rejects.toThrow(
      /No matching chunks found to disable: c1, c2/
    )
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
      // Two more spellings of the same shape, both of which the first pass of
      // this detector missed: `added`/`failed` (indexing workspace files) and
      // `processed`/`errors` (a bulk chunk update).
      if (/^\s+processed\s*:/m.test(declared) && /^\s+errors\s*:/m.test(declared)) return true
      if (/^\s+added\s*:/m.test(declared) && /^\s+failed\s*:/m.test(declared)) return true
      return /^\s+moved\s*:/m.test(declared) && /^\s+failed\s*:/m.test(declared)
    })

    expect(shaped).toEqual(
      expect.arrayContaining(['addWorkspaceFilesToKnowledgeBase', 'bulkUpdateKnowledgeChunks'])
    )
    for (const operation of shaped) {
      if (UNCHECKED_BULK_OUTCOMES.has(operation)) continue
      expect(Object.keys(BULK_OUTCOME_CHECKS)).toContain(operation)
    }
  })
})
