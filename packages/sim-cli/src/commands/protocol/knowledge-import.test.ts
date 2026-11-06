import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildGeneratedCommands } from '../../runtime/build'
import { attachProtocolCommands } from './index'

const { mockRequest } = vi.hoisted(() => ({ mockRequest: vi.fn() }))

/** The poll loop's own wait; a real 1.5s pause per poll is not worth testing through. */
vi.mock('node:timers/promises', () => ({ setTimeout: () => Promise.resolve() }))

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
  mockRequest.mockReset()
  dir = mkdtempSync(join(tmpdir(), 'sim-kb-import-'))
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(null, { status: 200, headers: { etag: '"etag-1"' } }))
  )
})
afterEach(() => {
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

function bundlePath(name = 'support.simkb.zip'): string {
  const path = join(dir, name)
  writeFileSync(path, 'PK-bundle')
  return path
}

function importRecord(extra: Record<string, unknown> = {}) {
  return {
    id: 'import_1',
    workspaceId: 'ws_local',
    status: 'uploading',
    knowledgeBaseId: null,
    documentsTotal: 0,
    documentsImported: 0,
    documentsFailed: 0,
    vectorsReused: false,
    failures: [],
    error: null,
    createdAt: '2026-10-22T00:00:00.000Z',
    updatedAt: '2026-10-22T00:00:00.000Z',
    completedAt: null,
    ...extra,
  }
}

/** Create, then complete; the bundle bytes go to the signed URL in between. */
function startedImport(completed: Record<string, unknown>) {
  mockRequest
    .mockResolvedValueOnce({
      data: {
        session: importRecord(),
        uploadToken: 'secret-token',
        transfer: {
          method: 'put',
          url: 'https://storage.example/bundle',
          headers: { 'content-type': 'application/zip' },
          expiresAt: '2026-10-22T01:00:00.000Z',
        },
      },
    })
    .mockResolvedValueOnce({ data: importRecord(completed) })
}

function captureOutput(): string[] {
  const logged: string[] = []
  vi.spyOn(console, 'log').mockImplementation((line: string) => logged.push(line))
  return logged
}

async function runImport(argv: string[]) {
  await program().parseAsync(['node', 'sim', 'kb', 'import', ...argv])
}

describe('knowledge import', () => {
  it('refuses a file that is not a zip archive before contacting the API', async () => {
    await expect(runImport([bundlePath('support.tar')])).rejects.toThrow(/must be a \.zip archive/)
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it('uploads the bundle, waits for the import, and prints the new base without the upload token', async () => {
    const path = bundlePath()
    startedImport({ status: 'processing', documentsTotal: 2 })
    mockRequest.mockResolvedValueOnce({
      data: importRecord({
        status: 'completed',
        knowledgeBaseId: 'kb_new',
        documentsTotal: 2,
        documentsImported: 2,
        vectorsReused: true,
      }),
    })
    const logged = captureOutput()

    await runImport([path, '--name', 'Support copy'])

    expect(mockRequest.mock.calls[0]).toEqual([
      '/api/v2/knowledge/imports',
      {
        method: 'POST',
        body: {
          workspaceId: 'ws_local',
          name: 'Support copy',
          source: {
            type: 'upload',
            name: 'support.simkb.zip',
            contentType: 'application/zip',
            size: 9,
          },
        },
      },
    ])
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      'https://storage.example/bundle',
      expect.objectContaining({ method: 'PUT' })
    )
    expect(mockRequest.mock.calls[1][0]).toBe('/api/v2/knowledge/imports/import_1/complete')
    expect(mockRequest.mock.calls[2][0]).toBe('/api/v2/knowledge/imports/import_1')
    expect(JSON.parse(logged[0])).toEqual({
      id: 'import_1',
      status: 'completed',
      knowledgeBaseId: 'kb_new',
      documentsTotal: 2,
      documentsImported: 2,
      documentsFailed: 0,
      vectorsReused: true,
    })
    expect(logged[0]).not.toContain('secret-token')
  })

  it('returns once the import starts with --no-wait', async () => {
    startedImport({ status: 'processing' })
    const logged = captureOutput()

    await runImport([bundlePath(), '--no-wait'])

    expect(mockRequest).toHaveBeenCalledTimes(2)
    expect(JSON.parse(logged[0])).toMatchObject({ id: 'import_1', status: 'processing' })
  })

  it('reports the documents an otherwise completed import skipped', async () => {
    startedImport({
      status: 'completed',
      knowledgeBaseId: 'kb_new',
      documentsTotal: 2,
      documentsImported: 1,
      documentsFailed: 1,
      failures: [{ filename: 'scan.tiff', message: 'Unsupported file type' }],
    })
    const logged = captureOutput()

    await runImport([bundlePath()])

    expect(JSON.parse(logged[0])).toMatchObject({
      documentsFailed: 1,
      failures: ['scan.tiff: Unsupported file type'],
    })
  })

  it('fails with the import error when the import does not complete', async () => {
    startedImport({
      status: 'failed',
      error: 'Invalid knowledge base bundle: not a zip archive',
    })
    captureOutput()

    await expect(runImport([bundlePath()])).rejects.toThrow(
      'Import failed: Invalid knowledge base bundle: not a zip archive'
    )
  })
})
