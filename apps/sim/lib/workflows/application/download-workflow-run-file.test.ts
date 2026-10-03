import type { Principal } from '@sim/auth/principal'
import {
  createPersonalApiKeyPrincipal,
  createSessionPrincipal,
  createWorkspaceApiKeyPrincipal,
} from '@sim/testing/factories/principal.factory'
import { storageServiceMock, storageServiceMockFns } from '@sim/testing/mocks/storage-service.mock'
import {
  workflowContextMock,
  workflowContextMockFns,
} from '@sim/testing/mocks/workflow-context.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getRunFiles: vi.fn(),
}))

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

vi.mock('@/lib/workflows/application/context', () => workflowContextMock)

vi.mock('@/lib/workflows/executor/execution-run-files', () => ({
  getWorkflowRunFiles: mocks.getRunFiles,
}))

vi.mock('@/lib/uploads/core/storage-service', () => storageServiceMock)

import { Readable } from 'node:stream'
import { downloadWorkflowRunFileStream } from '@/lib/workflows/application/download-workflow-run-file'

const mockDownloadFileStream = storageServiceMockFns.mockDownloadFileStream

const mockResolvePermission = workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission

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
  createSessionPrincipal(),
  createPersonalApiKeyPrincipal({ keyId: 'key-personal' }),
  createWorkspaceApiKeyPrincipal({ keyId: 'key-workspace' }),
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
    mockResolvePermission.mockResolvedValue('read')
    workflowContextMockFns.mockResolveActiveWorkflowRunApplicationContext.mockResolvedValue(
      runContext
    )
    mocks.getRunFiles.mockResolvedValue(terminalRun())
    mockDownloadFileStream.mockResolvedValue(Readable.from([Buffer.from('pdf')]))
  })

  it.each(principals)('allows $kind at the read role', async (principal) => {
    const result = await downloadWorkflowRunFileStream.execute({ principal, input: input() })

    expect(result.file.id).toBe(FILE_ID)
    expect(result.contentType).toBe('application/pdf')
    expect(result.contentLength).toBe(3)
  })

  /**
   * `HEAD` on this route runs the authorization phase alone. With the file
   * lookup downstream of it, `authorize` succeeded for any id at all, so a
   * `HEAD` answered `200` for a file the `GET` beside it would `404` — the two
   * verbs disagreed about whether the resource existed. The route test above
   * could not catch it: it mocks this use case and makes `authorize` reject, so
   * it only ever proved the route renders a rejection.
   */
  it('refuses to authorize a file id the run never produced', async () => {
    await expect(
      downloadWorkflowRunFileStream.authorize({
        principal: principals[0],
        input: input({ fileId: 'file_absent' }),
      })
    ).rejects.toThrow('File not found')
    expect(mockDownloadFileStream).not.toHaveBeenCalled()
  })

  it('denies a principal below the read role', async () => {
    mockResolvePermission.mockResolvedValue(null)

    await expect(
      downloadWorkflowRunFileStream.execute({ principal: principals[0], input: input() })
    ).rejects.toThrow()
    expect(mockDownloadFileStream).not.toHaveBeenCalled()
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

    expect(mockDownloadFileStream).toHaveBeenCalledWith({
      key: FILE_KEY,
      context: 'execution',
    })
  })

  it('resolves the run canonically before authorizing or reading', async () => {
    workflowContextMockFns.mockResolveActiveWorkflowRunApplicationContext.mockRejectedValueOnce(
      Object.assign(new Error('Run not found'), { code: 'not_found' })
    )

    await expect(
      downloadWorkflowRunFileStream.execute({
        principal: workspaceKeyPrincipal,
        input: input({ workflowId: 'other-workflow' }),
      })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(mockResolvePermission).not.toHaveBeenCalled()
    expect(mocks.getRunFiles).not.toHaveBeenCalled()
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
    expect(mockDownloadFileStream).not.toHaveBeenCalled()
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
    expect(mockDownloadFileStream).not.toHaveBeenCalled()
  })

  /** Storage failure is infrastructure, not a missing resource. */
  it('propagates a storage failure rather than concealing it as not found', async () => {
    mockDownloadFileStream.mockRejectedValueOnce(new Error('s3 unavailable'))

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
      mockDownloadFileStream.mockRejectedValueOnce(Object.assign(new Error('gone'), { name }))

      await expect(
        downloadWorkflowRunFileStream.execute({
          principal: workspaceKeyPrincipal,
          input: input(),
        })
      ).rejects.toMatchObject({ code: 'not_found' })
    }
  )
})
