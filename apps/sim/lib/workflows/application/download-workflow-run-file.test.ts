/**
 * @vitest-environment node
 */
import type { Principal } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getRunFiles: vi.fn(),
  downloadFileStream: vi.fn(),
  resolvePermission: vi.fn(),
  resolveRunContext: vi.fn(),
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null, required: string) => {
    const rank = { read: 1, write: 2, admin: 3 } as const
    return (
      actual !== null && rank[actual as keyof typeof rank] >= rank[required as keyof typeof rank]
    )
  },
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

vi.mock('@/lib/workflows/application/context', () => ({
  resolveActiveWorkflowRunApplicationContext: mocks.resolveRunContext,
}))

vi.mock('@/lib/workflows/executor/execution-run-files', () => ({
  getWorkflowRunFiles: mocks.getRunFiles,
}))

vi.mock('@/lib/uploads/core/storage-service', () => ({
  downloadFileStream: mocks.downloadFileStream,
}))

import { Readable } from 'node:stream'
import { downloadWorkflowRunFileStream } from '@/lib/workflows/application/download-workflow-run-file'

const WORKFLOW_ID = 'workflow-1'
const RUN_ID = 'run-1'
const FILE_ID = 'file_report'
const FILE_KEY = 'execution/workspace-1/workflow-1/run-1/report.pdf'

const runContext = {
  workflowId: WORKFLOW_ID,
  workflow: { id: WORKFLOW_ID },
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
  runId: RUN_ID,
}

const principals: Principal[] = [
  { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
  { kind: 'personal_api_key', userId: 'user-1', keyId: 'key-personal' },
  { kind: 'workspace_api_key', workspaceId: 'workspace-1', keyId: 'key-workspace' },
  {
    kind: 'delegated',
    serviceId: 'copilot',
    subjectUserId: 'user-1',
    workspaceId: 'workspace-1',
    delegationId: 'delegation-1',
    audience: 'sim:workflows',
    issuedAt: new Date('2026-01-01T00:00:00Z'),
    expiresAt: new Date('2999-01-01T00:00:00Z'),
  },
]

const workspaceKeyPrincipal = principals[2]

function runFile(overrides: Record<string, unknown> = {}) {
  return {
    id: FILE_ID,
    name: 'report.pdf',
    url: `/api/files/serve/s3/${encodeURIComponent(FILE_KEY)}`,
    size: 3,
    type: 'application/pdf',
    key: FILE_KEY,
    ...overrides,
  }
}

function terminalRun(files: Record<string, unknown>[] = [runFile()]) {
  return {
    terminal: true,
    workspaceId: 'workspace-1',
    filesById: new Map(files.map((file) => [file.id as string, file])),
  }
}

function input(overrides: Record<string, unknown> = {}) {
  return { workflowId: WORKFLOW_ID, runId: RUN_ID, fileId: FILE_ID, ...overrides }
}

describe('downloadWorkflowRunFileStream', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolvePermission.mockResolvedValue('read')
    mocks.resolveRunContext.mockResolvedValue(runContext)
    mocks.getRunFiles.mockResolvedValue(terminalRun())
    mocks.downloadFileStream.mockResolvedValue(Readable.from([Buffer.from('pdf')]))
  })

  it.each(principals)('allows $kind at the read role', async (principal) => {
    const result = await downloadWorkflowRunFileStream.execute({ principal, input: input() })

    expect(result.file.id).toBe(FILE_ID)
    expect(result.contentType).toBe('application/pdf')
    expect(result.contentLength).toBe(3)
  })

  it('denies a principal below the read role', async () => {
    mocks.resolvePermission.mockResolvedValue(null)

    await expect(
      downloadWorkflowRunFileStream.execute({ principal: principals[0], input: input() })
    ).rejects.toThrow()
    expect(mocks.downloadFileStream).not.toHaveBeenCalled()
  })

  /**
   * The key-derivation invariant: the storage key handed to the object store is
   * read off the run's own recording, so a caller can only ever reach bytes the
   * addressed run produced.
   */
  it('takes the storage key from the run record, not the request', async () => {
    await downloadWorkflowRunFileStream.execute({
      principal: workspaceKeyPrincipal,
      input: input({ key: 'execution/other-workspace/wf/run/secret.pdf' } as never),
    })

    expect(mocks.downloadFileStream).toHaveBeenCalledWith({
      key: FILE_KEY,
      context: 'execution',
    })
  })

  it('resolves the run canonically before authorizing or reading', async () => {
    mocks.resolveRunContext.mockRejectedValueOnce(
      Object.assign(new Error('Run not found'), { code: 'not_found' })
    )

    await expect(
      downloadWorkflowRunFileStream.execute({
        principal: workspaceKeyPrincipal,
        input: input({ workflowId: 'other-workflow' }),
      })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.resolvePermission).not.toHaveBeenCalled()
    expect(mocks.getRunFiles).not.toHaveBeenCalled()
  })

  it('reports an unknown run as not found', async () => {
    mocks.getRunFiles.mockResolvedValueOnce(null)

    await expect(
      downloadWorkflowRunFileStream.execute({ principal: workspaceKeyPrincipal, input: input() })
    ).rejects.toMatchObject({ code: 'not_found', message: 'File not found' })
  })

  /**
   * A file id belonging to a different run of the same workflow must not
   * resolve — the run's own recording is the only index consulted.
   */
  it('reports a file id absent from this run as not found', async () => {
    mocks.getRunFiles.mockResolvedValueOnce(terminalRun([runFile({ id: 'file_other_run' })]))

    await expect(
      downloadWorkflowRunFileStream.execute({ principal: workspaceKeyPrincipal, input: input() })
    ).rejects.toMatchObject({ code: 'not_found', message: 'File not found' })
    expect(mocks.downloadFileStream).not.toHaveBeenCalled()
  })

  /** Unknown run and unknown file share one message so neither can be probed. */
  it('uses one message for an unknown run and an unknown file', async () => {
    mocks.getRunFiles.mockResolvedValueOnce(null)
    const unknownRun = await downloadWorkflowRunFileStream
      .execute({ principal: workspaceKeyPrincipal, input: input() })
      .catch((error: Error) => error.message)

    mocks.getRunFiles.mockResolvedValueOnce(terminalRun([]))
    const unknownFile = await downloadWorkflowRunFileStream
      .execute({ principal: workspaceKeyPrincipal, input: input() })
      .catch((error: Error) => error.message)

    expect(unknownRun).toBe(unknownFile)
  })

  it('reports a run still in flight as a conflict', async () => {
    mocks.getRunFiles.mockResolvedValueOnce({
      terminal: false,
      workspaceId: 'workspace-1',
      filesById: new Map(),
    })

    await expect(
      downloadWorkflowRunFileStream.execute({ principal: workspaceKeyPrincipal, input: input() })
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(mocks.downloadFileStream).not.toHaveBeenCalled()
  })

  /** Storage failure is infrastructure, not a missing resource. */
  it('propagates a storage failure rather than concealing it as not found', async () => {
    mocks.downloadFileStream.mockRejectedValueOnce(new Error('s3 unavailable'))

    await expect(
      downloadWorkflowRunFileStream.execute({ principal: workspaceKeyPrincipal, input: input() })
    ).rejects.toThrow('s3 unavailable')
  })

  /**
   * A run's log row outlives its bytes, so an object retention has collected is
   * reachable through a perfectly valid run and file id. It resolves to the same
   * shared not-found message as an unknown id, deliberately: separating them
   * would tell a caller which ids exist.
   */
  it.each(['NoSuchKey', 'BlobNotFound', 'NotFound'])(
    'reports a swept object (%s) as not found rather than a fault',
    async (name) => {
      mocks.downloadFileStream.mockRejectedValueOnce(Object.assign(new Error('gone'), { name }))

      await expect(
        downloadWorkflowRunFileStream.execute({
          principal: workspaceKeyPrincipal,
          input: input(),
        })
      ).rejects.toMatchObject({ code: 'not_found' })
    }
  )

  it('falls back to a generic content type when the record has none', async () => {
    mocks.getRunFiles.mockResolvedValueOnce(terminalRun([runFile({ type: '' })]))

    const result = await downloadWorkflowRunFileStream.execute({
      principal: workspaceKeyPrincipal,
      input: input(),
    })

    expect(result.contentType).toBe('application/octet-stream')
  })
})
