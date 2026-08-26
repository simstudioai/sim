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
  dir = mkdtempSync(join(tmpdir(), 'sim-kb-upload-'))
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
  const override = (command: Command) => {
    command.exitOverride()
    command.commands.forEach(override)
  }
  override(root)
  return root
}

function uploadSession() {
  return {
    id: 'upload_1',
    knowledgeBaseId: 'kb_1',
    status: 'uploading',
    name: 'notes.doc',
    contentType: 'application/msword',
    size: 5,
    expiresAt: '2026-08-04T20:00:00.000Z',
    error: null,
    document: null,
  }
}

describe('knowledge documents upload', () => {
  it('owns the multipart protocol while hiding its low-level operations', () => {
    const root = program()
    const knowledge = root.commands.find((command) => command.name() === 'knowledge')
    expect(root.commands.map((command) => command.name())).not.toContain('documents')

    const documents = knowledge?.commands.find((command) => command.name() === 'documents')
    expect(documents?.commands.map((command) => command.name())).toContain('upload')
    expect(documents?.commands.map((command) => command.name())).not.toEqual(
      expect.arrayContaining(['uploads', 'parts', 'complete'])
    )
    expect(
      documents?.commands.find((command) => command.name() === 'upload')?.helpInformation()
    ).toContain('<knowledgeBaseId> <path>')
  })

  it('uploads a local document and prints the created document without transfer secrets', async () => {
    const path = join(dir, 'notes.doc')
    writeFileSync(path, 'hello')
    const session = uploadSession()
    mockRequest
      .mockResolvedValueOnce({
        data: {
          session,
          uploadToken: 'secret-token',
          transfer: { method: 'multipart', partSize: 10, partCount: 1 },
        },
      })
      .mockResolvedValueOnce({
        data: {
          parts: [
            {
              partNumber: 1,
              url: 'https://storage.example/part',
              headers: { 'content-type': 'application/octet-stream' },
              expiresAt: '2026-08-04T20:00:00.000Z',
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: {
          ...session,
          status: 'completed',
          document: {
            id: 'doc_1',
            knowledgeBaseId: 'kb_1',
            filename: 'notes.doc',
            fileSize: 5,
            mimeType: 'application/msword',
            processingStatus: 'pending',
            chunkCount: 0,
            tokenCount: 0,
            characterCount: 0,
            enabled: true,
            createdAt: '2026-08-04T19:00:00.000Z',
          },
        },
      })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(null, {
          status: 200,
          headers: { etag: '"etag-1"' },
        })
      )
    )
    const logged: string[] = []
    vi.spyOn(console, 'log').mockImplementation((line: string) => logged.push(line))

    await program().parseAsync([
      'node',
      'sim',
      'kb',
      'documents',
      'upload',
      'kb_1',
      path,
      '--tag',
      'customer',
      'priority',
      '--recipe',
      'default',
      '--lang',
      'en',
    ])

    expect(mockRequest.mock.calls[0]).toEqual([
      '/api/v2/knowledge/kb_1/documents/uploads',
      {
        method: 'POST',
        body: {
          workspaceId: 'ws_local',
          name: 'notes.doc',
          contentType: 'application/msword',
          size: 5,
          tag1: 'customer',
          tag2: 'priority',
          processingOptions: { recipe: 'default', lang: 'en' },
        },
      },
    ])
    expect(mockRequest.mock.calls[1][0]).toBe(
      '/api/v2/knowledge/kb_1/documents/uploads/upload_1/parts'
    )
    expect(mockRequest.mock.calls[2][0]).toBe(
      '/api/v2/knowledge/kb_1/documents/uploads/upload_1/complete'
    )
    expect(mockRequest.mock.calls[2][1]).toEqual({
      method: 'POST',
      query: { workspaceId: 'ws_local' },
      headers: { 'upload-token': 'secret-token' },
    })
    expect(JSON.parse(logged[0])).toEqual({
      id: 'doc_1',
      knowledgeBaseId: 'kb_1',
      name: 'notes.doc',
      size: 5,
      status: 'pending',
    })
    expect(logged[0]).not.toContain('secret-token')
  })

  it('rejects more tags than the protocol supports before making a request', async () => {
    const path = join(dir, 'notes.txt')
    writeFileSync(path, 'hello')

    await expect(
      program().parseAsync([
        'node',
        'sim',
        'kb',
        'documents',
        'upload',
        'kb_1',
        path,
        '--tag',
        '1',
        '2',
        '3',
        '4',
        '5',
        '6',
        '7',
        '8',
      ])
    ).rejects.toThrow(/at most seven/)
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it('requires the knowledge-base argument before reading the file', async () => {
    const path = join(dir, 'notes.txt')
    writeFileSync(path, 'hello')

    await expect(
      program().parseAsync(['node', 'sim', 'kb', 'documents', 'upload'])
    ).rejects.toThrow(/missing required argument 'knowledgeBaseId'/)
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it('rejects an extra positional instead of silently dropping the file it names', async () => {
    const first = join(dir, 'alpha.txt')
    const second = join(dir, 'beta.md')
    writeFileSync(first, 'hello')
    writeFileSync(second, 'world')

    await expect(
      program().parseAsync(['node', 'sim', 'kb', 'documents', 'upload', 'kb_1', first, second])
    ).rejects.toThrow(/too many arguments/)
    expect(mockRequest).not.toHaveBeenCalled()
  })
})
