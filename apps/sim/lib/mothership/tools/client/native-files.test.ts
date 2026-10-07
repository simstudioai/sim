/** @vitest-environment jsdom */
import {
  apiClientRequestMock,
  apiClientRequestMockFns,
} from '@sim/testing/mocks/api-client-request.mock'
import { libDesktopMock, libDesktopMockFns } from '@sim/testing/mocks/lib-desktop.mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  invoke: vi.fn(),
  upload: vi.fn(),
  complete: vi.fn(),
  exit: vi.fn(),
}))
vi.mock('@/lib/desktop', () => libDesktopMock)
vi.mock('@/lib/api/client/request', () => apiClientRequestMock)
vi.mock('@/lib/uploads/client/session-upload', () => ({
  uploadWorkspaceFileSession: hoisted.upload,
}))
vi.mock('@/lib/mothership/tools/client/completion', () => ({
  reportClientToolCompletion: hoisted.complete,
  reportClientToolCompletionOnPageExit: hoisted.exit,
}))

import type { DesktopLocalFileManifest } from '@sim/desktop-bridge'
import { ApiClientError } from '@/lib/api/client/errors'
import { renewDesktopToolLeaseContract } from '@/lib/api/contracts/desktop-executor'
import {
  executeNativeFileTool,
  importNativeFiles,
} from '@/lib/mothership/tools/client/native-files'

const mocks = { ...hoisted, json: apiClientRequestMockFns.mockRequestJson }

const manifest: DesktopLocalFileManifest = {
  kind: 'manifest',
  name: 'Reports',
  targetWorkspaceId: 'workspace',
  folderId: 'destination',
  entries: [
    { relativePath: '', kind: 'directory', size: 0, revision: 'root' },
    { relativePath: 'empty', kind: 'directory', size: 0, revision: 'empty' },
    { relativePath: 'report.txt', kind: 'file', size: 3, revision: 'file' },
  ],
}
beforeEach(() => {
  vi.resetAllMocks()
  libDesktopMockFns.mockGetDesktopBridge.mockReturnValue({ localFiles: mocks.invoke })
  mocks.json.mockResolvedValue({ folder: { id: 'created-folder' } })
  mocks.upload.mockResolvedValue({ id: 'saved-file', name: 'report.txt' })
  mocks.invoke.mockResolvedValue({
    ok: true,
    data: { kind: 'chunk', bytes: new Uint8Array([65, 66, 67]), eof: true },
  })
})

it('materializes a directory into its explicit workspace using file sessions and preserved parent folders', async () => {
  expect(await importNativeFiles('tool', manifest)).toMatchObject({
    success: true,
    workspaceId: 'workspace',
    files: [{ id: 'saved-file', relativePath: 'report.txt' }],
    folders: [{ relativePath: '' }, { relativePath: 'empty' }],
  })
  expect(mocks.json.mock.calls[0][1]).toMatchObject({
    params: { id: 'workspace' },
    body: { name: 'Reports', parentId: 'destination' },
  })
  expect(mocks.json.mock.calls[1][1]).toMatchObject({
    body: { name: 'empty', parentId: 'created-folder' },
  })
  expect(mocks.upload).toHaveBeenCalledWith(
    expect.objectContaining({
      workspaceId: 'workspace',
      folderId: 'created-folder',
      file: expect.any(File),
    })
  )
  const file = mocks.upload.mock.calls[0][0].file as File
  expect(file.name).toBe('report.txt')
  expect(file.size).toBe(3)
  expect(mocks.invoke).toHaveBeenCalledWith({
    operation: 'chunk',
    toolCallId: 'tool',
    relativePath: 'report.txt',
    revision: 'file',
    offset: 0,
  })
})

it('reports partial imports without repeating successful uploads', async () => {
  const input = {
    ...manifest,
    entries: [
      ...manifest.entries,
      { relativePath: 'second.txt', kind: 'file' as const, size: 3, revision: 'second' },
    ],
  }
  mocks.upload
    .mockResolvedValueOnce({ id: 'saved-file', name: 'report.txt' })
    .mockRejectedValueOnce(new Error('Storage unavailable'))
  expect(await importNativeFiles('tool', input)).toMatchObject({
    success: false,
    partial: true,
    doNotRetry: true,
    files: [{ id: 'saved-file' }],
    error: 'Storage unavailable',
  })
  expect(mocks.upload).toHaveBeenCalledTimes(2)
})

it('a replayed import claim produces neither another upload nor a competing completion', async () => {
  mocks.invoke.mockResolvedValue({ ok: false, code: 'ALREADY_STARTED', error: 'already started' })
  await executeNativeFileTool('tool', 'import_local_files')
  expect(mocks.upload).not.toHaveBeenCalled()
  expect(mocks.complete).not.toHaveBeenCalled()
})

it('returns local visual observations through the existing completion path', async () => {
  const data = {
    kind: 'read',
    path: '/image.png',
    representation: 'visual',
    observations: [{ name: 'image', mediaType: 'image/png', data: 'YWJj' }],
  }
  mocks.invoke.mockResolvedValue({ ok: true, data })
  await executeNativeFileTool('tool', 'read_local_file')
  expect(mocks.complete).toHaveBeenCalledWith('tool', 'success', expect.any(String), data)
  expect(mocks.upload).not.toHaveBeenCalled()
})

it('an import the user stopped leaves its outcome to Stop instead of reporting a failure', async () => {
  const stop = new AbortController()
  mocks.invoke.mockResolvedValueOnce({ ok: true, data: manifest })
  mocks.upload.mockImplementationOnce(async () => {
    stop.abort('user_stop:client_stopGeneration')
    throw new DOMException('The operation was aborted.', 'AbortError')
  })
  await executeNativeFileTool('tool', 'import_local_files', stop.signal)
  expect(mocks.complete).not.toHaveBeenCalled()
  expect(mocks.exit).not.toHaveBeenCalled()
})

it('a read the user stopped while the desktop was reading reports nothing', async () => {
  const stop = new AbortController()
  mocks.invoke.mockImplementationOnce(async () => {
    stop.abort('user_stop:client_stopGeneration')
    return {
      ok: true,
      data: { kind: 'read', path: '/notes.txt', representation: 'text', text: 'notes' },
    }
  })
  await executeNativeFileTool('tool', 'read_local_file', stop.signal)
  expect(mocks.complete).not.toHaveBeenCalled()
})

describe('an import keeps its lease while it runs', () => {
  /** The import's upload, which the test finishes when it chooses. */
  let finishUpload: () => void
  /** What the server answers each lease renewal, in turn. */
  let renewals: Array<() => Promise<unknown>>
  const renewalsSent = () =>
    mocks.json.mock.calls.filter(([contract]) => contract === renewDesktopToolLeaseContract).length

  beforeEach(() => {
    vi.useFakeTimers()
    renewals = []
    mocks.invoke.mockImplementation(async (request: { operation: string }) =>
      request.operation === 'manifest'
        ? { ok: true, data: manifest }
        : { ok: true, data: { kind: 'chunk', bytes: new Uint8Array([65, 66, 67]), eof: true } }
    )
    mocks.upload.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishUpload = () => resolve({ id: 'saved-file', name: 'report.txt' })
        })
    )
    mocks.json.mockImplementation(async (contract: unknown) => {
      if (contract !== renewDesktopToolLeaseContract) return { folder: { id: 'created-folder' } }
      const answer = renewals.shift()
      return answer ? answer() : { renewed: true }
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const refused = (status: number) => () =>
    Promise.reject(new ApiClientError({ message: `HTTP ${status}`, status, body: {} }))

  it('renews at once, then every heartbeat, and stops when the import ends', async () => {
    const run = executeNativeFileTool('tool', 'import_local_files')
    await vi.advanceTimersByTimeAsync(0)
    expect(renewalsSent()).toBe(1)
    await vi.advanceTimersByTimeAsync(40_000)
    expect(renewalsSent()).toBe(3)
    finishUpload()
    await run
    await vi.advanceTimersByTimeAsync(60_000)
    expect(renewalsSent()).toBe(3)
  })

  it('stops renewing once the server refuses the call', async () => {
    renewals.push(refused(410))
    const run = executeNativeFileTool('tool', 'import_local_files')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(renewalsSent()).toBe(1)
    finishUpload()
    await run
  })

  it('keeps renewing through failures that may pass', async () => {
    renewals.push(refused(401), refused(429), refused(503))
    const run = executeNativeFileTool('tool', 'import_local_files')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(renewalsSent()).toBe(4)
    finishUpload()
    await run
  })
})
