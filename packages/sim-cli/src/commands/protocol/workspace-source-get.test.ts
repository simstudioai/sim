import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SimApiError } from '../../http/client'
import { contextMockFns, contextMockState } from '../../test/context-mock'
import { attachWorkspaceSourceApply } from './workspace-source-apply'
import { attachWorkspaceSourceGet } from './workspace-source-get'

vi.mock('../../context', async () => (await import('../../test/context-mock')).contextMock)

const { mockRequest: request, mockRequestRaw: requestRaw } = contextMockFns
const SOURCE_PATH = '/api/v2/workspaces/ws_local/source'
const CATALOG_PATH = '/api/v2/workspaces/ws_local/workflows/source/catalog'
const CATALOG = JSON.parse(
  readFileSync(join(__dirname, '../../../../workflow-sdk/test/fixtures/catalog.json'), 'utf8')
)
const LEADS = "// @sim-sdk 1\nexport default defineTable({ name: 'leads', columns: {} })\n"
const ACCOUNTS = "// @sim-sdk 1\nexport default defineTable({ name: 'accounts', columns: {} })\n"

let rootDir: string
let dir: string

function serve(
  files: Record<string, string>,
  {
    kinds = ['table'],
    resources = {},
    blobs = [],
  }: { kinds?: string[]; resources?: object; blobs?: object[] } = {}
) {
  request.mockImplementation(async (path: string) => {
    if (path === SOURCE_PATH) {
      return {
        data: {
          workspaceId: 'ws_local',
          kinds,
          files,
          blobs,
          base: { version: 1, workspaceId: 'ws_local', resources },
          skipped: [],
          diagnostics: [],
        },
      }
    }
    if (path === CATALOG_PATH) return { data: CATALOG }
    throw new SimApiError('not found', 404)
  })
}

async function get(...argv: string[]): Promise<void> {
  const root = new Command('sim')
  attachWorkspaceSourceGet(root.command('workspaces').command('source'))
  root.exitOverride()
  await root.parseAsync(['node', 'sim', 'workspaces', 'source', 'get', '--dir', dir, ...argv])
}

beforeEach(() => {
  contextMockState.output = 'json'
  request.mockReset()
  requestRaw.mockReset()
  rootDir = mkdtempSync(join(tmpdir(), 'sim-workspace-get-'))
  dir = join(rootDir, 'out')
  vi.stubEnv('SIM_CONFIG_DIR', join(rootDir, 'config'))
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  rmSync(rootDir, { recursive: true, force: true })
})

describe('workspaces source get', () => {
  it('removes a file whose resource is gone, but refuses to replace an unapplied edit', async () => {
    serve({ 'tables/leads.ts': LEADS, 'tables/accounts.ts': ACCOUNTS })
    await get()
    expect(readFileSync(join(dir, 'tables/accounts.ts'), 'utf8')).toBe(ACCOUNTS)
    expect(existsSync(join(dir, '.sim/sdk/workspace/table.d.ts'))).toBe(true)
    expect(readFileSync(join(dir, '.sim/sdk/workspace.d.ts'), 'utf8')).toContain(
      "import('../../tables/leads')"
    )

    serve({ 'tables/leads.ts': LEADS })
    await get()
    expect(existsSync(join(dir, 'tables/accounts.ts'))).toBe(false)

    writeFileSync(join(dir, 'tables/leads.ts'), `${LEADS}// my edit\n`)
    serve({ 'tables/leads.ts': `${LEADS}// server\n` })
    await expect(get()).rejects.toThrow(/edits no apply has saved \(tables\/leads\.ts\)/)
    expect(readFileSync(join(dir, 'tables/leads.ts'), 'utf8')).toBe(`${LEADS}// my edit\n`)

    await get('--force')
    expect(readFileSync(join(dir, 'tables/leads.ts'), 'utf8')).toBe(`${LEADS}// server\n`)
  })

  it('keeps the base entries of the kinds a get leaves unread', async () => {
    serve(
      { 'tables/leads.ts': LEADS },
      {
        kinds: ['table', 'workflow'],
        resources: {
          'table:leads': { id: 'tbl_1', columns: { email: { id: 'col_1' } } },
          'workflow:old': { id: 'wf_1' },
        },
      }
    )
    await get()

    serve({}, { kinds: ['workflow'], resources: { 'workflow:ingest': { id: 'wf_2' } } })
    await get('--only', 'workflow')

    expect(JSON.parse(readFileSync(join(dir, '.sim/base.json'), 'utf8')).resources).toEqual({
      'table:leads': { id: 'tbl_1', columns: { email: { id: 'col_1' } } },
      'workflow:ingest': { id: 'wf_2' },
    })
  })

  describe('binary files', () => {
    const BYTES = Buffer.from([0, 1, 2, 250, 255])
    const listed = (bytes: Buffer = BYTES) => ({
      path: 'files/report.bin',
      sha256: createHash('sha256').update(bytes).digest('hex'),
      size: bytes.length,
      id: 'file_1',
      href: '/api/v2/files/file_1?workspaceId=ws_local',
    })
    const fileResource = {
      'file:report.bin': {
        id: 'file_1',
        blobs: { 'files/report.bin': { id: 'file_1', rev: 1, sha256: listed().sha256 } },
      },
    }

    it('downloads each listed blob through its v2 file route and records its digest', async () => {
      serve({ 'tables/leads.ts': LEADS }, { kinds: ['table', 'file'], blobs: [listed()] })
      requestRaw.mockImplementation(async () => new Response(BYTES))

      await get()

      expect(requestRaw).toHaveBeenCalledWith('/api/v2/files/file_1', {
        query: { workspaceId: 'ws_local' },
        method: 'GET',
      })
      expect(readFileSync(join(dir, 'files/report.bin'))).toEqual(BYTES)
      const written = JSON.parse(readFileSync(join(dir, '.sim/written.json'), 'utf8')).files
      expect(written['files/report.bin']).toBe(listed().sha256)

      requestRaw.mockClear()
      await get()
      expect(requestRaw).not.toHaveBeenCalled()
    })

    it('writes nothing when a download does not match its listing', async () => {
      serve({ 'tables/leads.ts': LEADS }, { kinds: ['table', 'file'], blobs: [listed()] })
      requestRaw.mockImplementation(async () => new Response(Buffer.from([9, 9, 9, 9, 9])))

      await expect(get()).rejects.toMatchObject({ code: 'SOURCE_BLOB_MISMATCH' })

      expect(existsSync(join(dir, 'files/report.bin'))).toBe(false)
      expect(existsSync(join(dir, 'tables/leads.ts'))).toBe(false)
      expect(existsSync(join(dir, '.sim/base.json'))).toBe(false)
    })

    it('refuses to overwrite a blob edited since the CLI wrote it', async () => {
      serve({}, { kinds: ['file'], blobs: [listed()] })
      requestRaw.mockImplementation(async () => new Response(BYTES))
      await get()
      writeFileSync(join(dir, 'files/report.bin'), Buffer.from([7]))
      const next = Buffer.from([1, 2, 3])
      serve({}, { kinds: ['file'], blobs: [listed(next)] })
      requestRaw.mockImplementation(async () => new Response(next))

      await expect(get()).rejects.toMatchObject({ code: 'SOURCE_LOCAL_EDITS' })
      expect(readFileSync(join(dir, 'files/report.bin'))).toEqual(Buffer.from([7]))
    })

    it('a get then an apply sends every blob by hash and plans from a complete directory', async () => {
      serve({}, { kinds: ['file'], blobs: [listed()], resources: fileResource })
      requestRaw.mockImplementation(async () => new Response(BYTES))
      await get()
      request.mockReset()
      request.mockResolvedValue({
        data: {
          workspaceId: 'ws_local',
          dryRun: true,
          plan: [],
          applied: [],
          needBlobs: [],
          remainingBlobs: [],
          files: {},
          base: { version: 1, workspaceId: 'ws_local', resources: fileResource },
          diagnostics: [],
        },
      })

      const root = new Command('sim')
      attachWorkspaceSourceApply(root.command('workspaces').command('source'))
      root.exitOverride()
      await root.parseAsync([
        'node',
        'sim',
        'workspaces',
        'source',
        'apply',
        '--dir',
        dir,
        '--dry-run',
        '--allow-delete',
      ])

      expect(request.mock.calls[0][1].body.blobs).toEqual([
        { path: 'files/report.bin', sha256: listed().sha256, size: BYTES.length },
      ])
    })
  })

  it('reads --only by folder name as well as by kind', async () => {
    serve({}, { kinds: ['custom-tool', 'knowledge-base'] })

    await get('--only', 'tools,knowledge-base,knowledge')

    const call = request.mock.calls.find(([path]) => path === SOURCE_PATH)
    expect(call?.[1].query).toEqual({ kinds: 'custom-tool,knowledge-base' })
    await expect(get('--only', 'gadgets')).rejects.toThrow(/Unknown kind gadgets/)
  })
})
