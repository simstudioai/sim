/** @vitest-environment jsdom */
import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  json: vi.fn(),
  upload: vi.fn(),
  complete: vi.fn(),
  exit: vi.fn(),
}))
vi.mock('@/lib/desktop', () => ({ getDesktopBridge: () => ({ localFiles: mocks.invoke }) }))
vi.mock('@/lib/api/client/request', () => ({ requestJson: mocks.json }))
vi.mock('@/lib/uploads/client/session-upload', () => ({ uploadWorkspaceFileSession: mocks.upload }))
vi.mock('@/lib/mothership/tools/client/completion', () => ({
  reportClientToolCompletion: mocks.complete,
  reportClientToolCompletionOnPageExit: mocks.exit,
}))

import type { DesktopLocalFileManifest } from '@sim/desktop-bridge'
import {
  executeNativeFileTool,
  importNativeFiles,
} from '@/lib/mothership/tools/client/native-files'

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
