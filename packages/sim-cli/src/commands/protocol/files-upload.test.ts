import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildGeneratedCommands } from '../../runtime/build'
import { attachProtocolCommands } from './index'

const { mockRequest } = vi.hoisted(() => ({
  mockRequest: vi.fn(),
}))

vi.mock('../../context', () => ({
  clientFrom: () => ({
    client: { request: mockRequest, requireWorkspace: () => 'ws_local' },
    profile: {
      workspaceId: 'ws_local',
      output: 'json',
      name: 'default',
      apiKey: 'k',
      endpoint: 'https://sim.example',
    },
  }),
}))

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sim-file-upload-'))
  mockRequest.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  rmSync(dir, { recursive: true, force: true })
})

function program(): Command {
  const root = new Command('sim').exitOverride()
  for (const group of buildGeneratedCommands()) root.addCommand(group)
  attachProtocolCommands(root)
  return root
}

describe('files upload', () => {
  it('uses a signed PUT transfer and completes without a request body', async () => {
    const path = join(dir, 'notes.txt')
    writeFileSync(path, 'hello')
    mockRequest
      .mockResolvedValueOnce({
        data: {
          session: {
            id: 'upload_1',
            status: 'uploading',
            name: 'notes.txt',
            contentType: 'text/plain',
            size: 5,
            expiresAt: '2026-08-04T20:00:00.000Z',
            error: null,
            file: null,
          },
          uploadToken: 'secret-token',
          transfer: {
            method: 'put',
            url: 'https://storage.example/file',
            headers: { 'content-type': 'text/plain' },
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          id: 'upload_1',
          status: 'completed',
          name: 'notes.txt',
          contentType: 'text/plain',
          size: 5,
          expiresAt: '2026-08-04T20:00:00.000Z',
          error: null,
          file: {
            id: 'file_1',
            name: 'notes.txt',
            size: 5,
            type: 'text/plain',
            key: 'workspace/ws_local/notes.txt',
            folderPath: '/',
            uploadedBy: 'user_1',
            uploadedAt: '2026-08-04T19:00:00.000Z',
            updatedAt: '2026-08-04T19:00:00.000Z',
          },
        },
      })
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const logged: string[] = []
    vi.spyOn(console, 'log').mockImplementation((line: string) => logged.push(line))

    await program().parseAsync(['node', 'sim', 'file', 'upload', path, '--folder', 'Reports'])

    expect(fetchMock).toHaveBeenCalledWith(
      'https://storage.example/file',
      expect.objectContaining({
        method: 'PUT',
        headers: { 'content-type': 'text/plain' },
        body: expect.any(Blob),
      })
    )
    expect(mockRequest.mock.calls[0]).toEqual([
      '/api/v2/files/uploads',
      {
        method: 'POST',
        body: {
          workspaceId: 'ws_local',
          name: 'notes.txt',
          contentType: 'text/plain',
          size: 5,
          folderPath: 'Reports',
        },
      },
    ])
    expect(mockRequest.mock.calls[1]).toEqual([
      '/api/v2/files/uploads/upload_1/complete',
      {
        method: 'POST',
        query: { workspaceId: 'ws_local' },
        headers: { 'upload-token': 'secret-token' },
      },
    ])
    expect(JSON.parse(logged[0])).toEqual({
      id: 'file_1',
      name: 'notes.txt',
      size: 5,
      type: 'text/plain',
      key: 'workspace/ws_local/notes.txt',
      folderPath: '/',
      uploadedBy: 'user_1',
      uploadedAt: '2026-08-04T19:00:00.000Z',
      updatedAt: '2026-08-04T19:00:00.000Z',
    })
    expect(logged[0]).not.toContain('secret-token')
  })

  it('encodes the destination folder, which the local path must never be', async () => {
    // This command builds its own body, so it never reached the encoder every
    // contract-driven `--folder` goes through: the same flag, the same value,
    // accepted by `files list` and rejected here as non-canonical.
    const path = join(dir, 'notes.txt')
    writeFileSync(path, 'hello')
    mockRequest
      .mockResolvedValueOnce({
        data: {
          session: { id: 'upload_1' },
          uploadToken: 'secret-token',
          transfer: { method: 'put', url: 'https://storage.example/file', headers: {} },
        },
      })
      .mockResolvedValueOnce({ data: { file: { id: 'file_1' } } })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })))
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await program().parseAsync(['node', 'sim', 'file', 'upload', path, '--folder', '/Q1 (draft)'])

    expect(mockRequest.mock.calls[0][1].body).toMatchObject({
      folderPath: '/Q1%20%28draft%29',
    })
  })
})
