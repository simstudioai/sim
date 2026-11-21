import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fingerprintOf } from '@sim/workspace-code'
import { knowledgeCodec } from '@sim/workspace-code/kinds/knowledge'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SimApiError } from '../../http/client'
import { contextMockFns, contextMockState, mockedProfile } from '../../test/context-mock'
import { runWorkflowSourceCheck, runWorkspaceSource } from '../../test/workspace-source-command'
import { blobBytes, blobDigests } from './workspace-source-blobs'
import { kindFolders } from './workspace-source-dir'

vi.mock('../../context', async () => (await import('../../test/context-mock')).contextMock)

const { mockRequest: request, mockRequestRaw: requestRaw } = contextMockFns
const SOURCE_PATH = '/api/v2/workspaces/ws_local/source'
const CATALOG_PATH = '/api/v2/workspaces/ws_local/workflows/source/catalog'
const RESOURCES_PATH = '/api/v2/workspaces/ws_local/workflows/source/resources'
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
    manifest,
  }: { kinds?: string[]; resources?: object; blobs?: object[]; manifest?: object } = {}
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
    if (path === RESOURCES_PATH && manifest) return { data: manifest }
    throw new SimApiError('not found', 404)
  })
}

function get(...argv: string[]): Promise<void> {
  return runWorkspaceSource('get', dir, ...argv)
}

/** Type-checks the directory a get wrote with its own tsconfig; returns tsc's output, or ''. */
function typecheckDirectory(): string {
  try {
    execFileSync(join(__dirname, '../../../../../node_modules/.bin/tsc'), ['--noEmit', '-p', dir], {
      encoding: 'utf8',
      stdio: 'pipe',
    })
    return ''
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string }
    return `${failure.stdout ?? ''}${failure.stderr ?? ''}`
  }
}

beforeEach(() => {
  contextMockState.output = 'json'
  contextMockState.workspaceSource = 'config'
  request.mockReset()
  requestRaw.mockReset()
  contextMockFns.mockProfileFrom.mockReturnValue({
    ...mockedProfile(),
    workspaceId: 'ws_local',
    output: 'json',
  })
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

  it('refuses a workflow source directory, --force included, keeping its base and unapplied edits', async () => {
    const base = JSON.stringify({
      workflowId: 'wf-1',
      workspaceId: 'ws_local',
      fingerprint: 'sf1:x',
      catalogHash: 'h',
    })
    mkdirSync(join(dir, '.sim'), { recursive: true })
    writeFileSync(join(dir, '.sim/base.json'), base)
    writeFileSync(join(dir, 'workflow.ts'), '// @sim-sdk 1\n// my unapplied edit\n')
    serve({ 'tables/leads.ts': LEADS })

    for (const flags of [[], ['--force']]) {
      await expect(get(...flags)).rejects.toMatchObject({
        code: 'SOURCE_DIR_KIND_MISMATCH',
        message: expect.stringContaining('is a workflow source directory (workflow wf-1)'),
      })
    }
    expect(readFileSync(join(dir, '.sim/base.json'), 'utf8')).toBe(base)
    expect(existsSync(join(dir, 'tables'))).toBe(false)
    expect(request).not.toHaveBeenCalled()
  })

  it('keeps the seed rows file of a table the answer declares seed rows for, which no read prints', async () => {
    const seeded = (name: string) =>
      `// @sim-sdk 1\nimport { column, defineTable } from '@sim/workflow-sdk/workspace'\n\nexport default defineTable({ name: '${name}', columns: { code: column.string() }, rows: { mode: 'seed' } })\n`
    const rows = '{"code":"a"}\n'
    serve({
      'tables/leads.ts': seeded('leads'),
      'tables/leads.rows.jsonl': rows,
      'tables/accounts.ts': seeded('accounts'),
      'tables/accounts.rows.jsonl': rows,
    })
    await get()

    serve({ 'tables/leads.ts': seeded('leads'), 'tables/accounts.ts': ACCOUNTS })
    await get()

    expect(readFileSync(join(dir, 'tables/leads.rows.jsonl'), 'utf8')).toBe(rows)
    expect(existsSync(join(dir, 'tables/accounts.rows.jsonl'))).toBe(false)
  })

  it('writes the workspace primer atop the guide, and the deep dives to the advanced guide it names', async () => {
    serve({ 'tables/leads.ts': LEADS })

    await get()

    const agents = readFileSync(join(dir, '.sim/AGENTS.md'), 'utf8')
    expect(agents.startsWith('# Sim workspace source: primer')).toBe(true)
    expect(agents).toContain('`.sim/GUIDE-advanced.md`')
    expect(agents).not.toContain('## Git and CI')
    const advanced = readFileSync(join(dir, '.sim/GUIDE-advanced.md'), 'utf8')
    for (const section of ['## Deletes', '## Git and CI', '## Promote to another workspace']) {
      expect(advanced).toContain(section)
    }
  })

  it('refuses to restore a file deleted since the CLI wrote it, a pending delete', async () => {
    serve({ 'tables/leads.ts': LEADS, 'tables/accounts.ts': ACCOUNTS })
    await get()
    rmSync(join(dir, 'tables/leads.ts'))

    await expect(get()).rejects.toThrow(/edits no apply has saved \(tables\/leads\.ts\)/)
    expect(existsSync(join(dir, 'tables/leads.ts'))).toBe(false)

    await get('--force')
    expect(readFileSync(join(dir, 'tables/leads.ts'), 'utf8')).toBe(LEADS)
  })

  it('refuses a workflow sidecar path that climbs out of its folder, writing nothing', async () => {
    serve({ 'tables/leads.ts': LEADS, 'workflows/../.sim/base.json': '{}' })

    await expect(get()).rejects.toThrow(/unsafe file path: workflows\/\.\.\/\.sim\/base\.json/)
    expect(existsSync(join(dir, 'tables/leads.ts'))).toBe(false)
  })

  it('keeps the skipped entries of the kinds a get leaves unread', async () => {
    const big = { kind: 'file', key: 'big.bin', reason: 'over the size limit' }
    serve({ 'tables/leads.ts': LEADS }, { kinds: ['table', 'file'] })
    request.mockImplementationOnce(async () => ({
      data: {
        workspaceId: 'ws_local',
        kinds: ['table', 'file'],
        files: { 'tables/leads.ts': LEADS },
        blobs: [],
        base: { version: 1, workspaceId: 'ws_local', resources: {} },
        skipped: [big],
        diagnostics: [],
      },
    }))
    await get()
    expect(vi.mocked(console.error).mock.calls.flat().join('\n')).toContain(
      'Skipped file big.bin: over the size limit'
    )

    serve({ 'tables/leads.ts': LEADS })
    await get('--only', 'table')

    expect(JSON.parse(readFileSync(join(dir, '.sim/skipped.json'), 'utf8'))).toEqual([big])
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

    it('hashes a blob listed without a hash and records it in the base as an apply fingerprints it', async () => {
      const sha256 = listed().sha256
      const doc = Buffer.from('# Refunds\n')
      const docSha = createHash('sha256').update(doc).digest('hex')
      const knowledge =
        "// @sim-sdk 1\nimport { defineKnowledgeBase } from '@sim/workflow-sdk/workspace'\n\nexport default defineKnowledgeBase({ name: 'Policies' })\n"
      serve(
        { 'knowledge/policies/knowledge.ts': knowledge },
        {
          kinds: ['file', 'knowledge-base'],
          blobs: [
            { ...listed(), sha256: undefined, rev: '7' },
            {
              path: 'knowledge/policies/docs/refunds.md',
              size: doc.length,
              id: 'doc_1',
              href: '/api/v2/knowledge/kb_1/documents/doc_1/content?workspaceId=ws_local',
              rev: '1700000000000',
            },
          ],
          resources: {
            'file:report.bin': { id: 'file_1' },
            'knowledge-base:policies': { id: 'kb_1', fingerprint: 'rf1:read-without-the-document' },
          },
        }
      )
      requestRaw.mockImplementation(
        async (path: string) => new Response(path.startsWith('/api/v2/files/') ? BYTES : doc)
      )

      await get()

      expect(requestRaw).toHaveBeenCalledWith('/api/v2/knowledge/kb_1/documents/doc_1/content', {
        query: { workspaceId: 'ws_local' },
        method: 'GET',
      })
      const base = JSON.parse(readFileSync(join(dir, '.sim/base.json'), 'utf8'))
      expect(base.resources['file:report.bin']).toEqual({
        id: 'file_1',
        fingerprint: fingerprintOf({ sha256 }),
        blobs: { 'files/report.bin': { id: 'file_1', rev: '7', sha256 } },
      })
      expect(base.resources['knowledge-base:policies']).toEqual({
        id: 'kb_1',
        fingerprint: fingerprintOf(
          knowledgeCodec.canonical({
            name: 'Policies',
            docs: { 'refunds.md': { sha256: docSha, size: doc.length } },
          })
        ),
        blobs: { 'refunds.md': { id: 'doc_1', rev: '1700000000000', sha256: docSha } },
      })
      const written = JSON.parse(readFileSync(join(dir, '.sim/written.json'), 'utf8')).files
      expect(written['files/report.bin']).toBe(sha256)
      expect(written['knowledge/policies/docs/refunds.md']).toBe(docSha)
    })

    it('writes nothing when a download does not match its listing', async () => {
      serve({ 'tables/leads.ts': LEADS }, { kinds: ['table', 'file'], blobs: [listed()] })
      requestRaw.mockImplementation(async () => new Response(Buffer.from([9, 9, 9, 9, 9])))

      await expect(get()).rejects.toMatchObject({ code: 'SOURCE_BLOB_MISMATCH' })

      expect(existsSync(join(dir, 'files/report.bin'))).toBe(false)
      expect(existsSync(join(dir, 'tables/leads.ts'))).toBe(false)
      expect(existsSync(join(dir, '.sim/base.json'))).toBe(false)
    })

    describe('a download that fails part-way', () => {
      const bytesOf = (name: string) => Buffer.from(`bytes of ${name}`)
      const listedNamed = (name: string, overrides: object = {}) => ({
        path: `files/${name}`,
        sha256: createHash('sha256').update(bytesOf(name)).digest('hex'),
        size: bytesOf(name).length,
        id: `file_${name}`,
        href: `/api/v2/files/file_${name}?workspaceId=ws_local`,
        ...overrides,
      })
      const NAMES = ['a.bin', 'b.bin', 'c.bin']
      const limited = () =>
        new SimApiError('API rate limit exceeded', 429, 'RATE_LIMITED', undefined, 9)
      /** Answers each download with its bytes, except `failing`, which is refused as rate limited. */
      const downloads = (failing: string | null) =>
        requestRaw.mockImplementation(async (path: string) => {
          const name = path.slice('/api/v2/files/file_'.length)
          if (name === failing) throw limited()
          return new Response(bytesOf(name))
        })
      const fetchedNames = () =>
        requestRaw.mock.calls.map(([path]) => String(path).slice('/api/v2/files/file_'.length))

      it('keeps the blobs it downloaded, and a rerun downloads only the rest', async () => {
        serve({}, { kinds: ['file'], blobs: NAMES.map((name) => listedNamed(name)) })
        downloads('c.bin')

        await expect(get()).rejects.toMatchObject({
          status: 429,
          exitCode: 9,
          message: expect.stringMatching(/2 of 3 binary files .* run the get again/),
        })
        expect(existsSync(join(dir, 'files/a.bin'))).toBe(false)
        expect(existsSync(join(dir, '.sim/base.json'))).toBe(false)

        requestRaw.mockClear()
        downloads(null)
        await get()

        expect(fetchedNames()).toEqual(['c.bin'])
        for (const name of NAMES) {
          expect(readFileSync(join(dir, `files/${name}`))).toEqual(bytesOf(name))
        }
        expect(existsSync(join(dir, '.sim/downloads'))).toBe(false)
      })

      it('downloads a kept blob again when its bytes no longer match the listing', async () => {
        serve({}, { kinds: ['file'], blobs: NAMES.map((name) => listedNamed(name)) })
        downloads('c.bin')
        await expect(get()).rejects.toMatchObject({ status: 429 })
        const keptA = readdirSync(join(dir, '.sim/downloads')).find((name) =>
          readFileSync(join(dir, '.sim/downloads', name)).equals(bytesOf('a.bin'))
        )
        writeFileSync(join(dir, '.sim/downloads', String(keptA)), 'bytes of a.biN')

        requestRaw.mockClear()
        downloads(null)
        await get()

        expect(fetchedNames().sort()).toEqual(['a.bin', 'c.bin'])
        expect(readFileSync(join(dir, 'files/a.bin'))).toEqual(bytesOf('a.bin'))
      })

      it('refuses a downloads folder that is a symbolic link, writing nothing through it', async () => {
        const elsewhere = join(rootDir, 'elsewhere')
        mkdirSync(elsewhere)
        mkdirSync(join(dir, '.sim'), { recursive: true })
        symlinkSync(elsewhere, join(dir, '.sim/downloads'))
        serve({}, { kinds: ['file'], blobs: NAMES.map((name) => listedNamed(name)) })
        downloads(null)

        await expect(get()).rejects.toMatchObject({ code: 'SOURCE_SYMLINK' })
        expect(readdirSync(elsewhere)).toEqual([])
        expect(requestRaw).not.toHaveBeenCalled()
      })

      it('refuses a kept download that is a symbolic link', async () => {
        serve({}, { kinds: ['file'], blobs: NAMES.map((name) => listedNamed(name)) })
        downloads('c.bin')
        await expect(get()).rejects.toMatchObject({ status: 429 })
        const keptA = String(
          readdirSync(join(dir, '.sim/downloads')).find((name) =>
            readFileSync(join(dir, '.sim/downloads', name)).equals(bytesOf('a.bin'))
          )
        )
        const outside = join(rootDir, 'outside.bin')
        writeFileSync(outside, bytesOf('a.bin'))
        rmSync(join(dir, '.sim/downloads', keptA))
        symlinkSync(outside, join(dir, '.sim/downloads', keptA))

        downloads(null)
        await expect(get()).rejects.toMatchObject({ code: 'SOURCE_SYMLINK' })
        expect(existsSync(join(dir, 'files/a.bin'))).toBe(false)
      })

      it('writes two paths listed with the same bytes', async () => {
        const twin = { ...listedNamed('a.bin'), path: 'files/copy-of-a.bin' }
        serve({}, { kinds: ['file'], blobs: [listedNamed('a.bin'), twin] })
        downloads(null)

        await get()

        expect(readFileSync(join(dir, 'files/a.bin'))).toEqual(bytesOf('a.bin'))
        expect(readFileSync(join(dir, 'files/copy-of-a.bin'))).toEqual(bytesOf('a.bin'))
      })

      it('removes its partial downloads on an interrupt and keeps the verified ones', async () => {
        serve({}, { kinds: ['file'], blobs: ['a.bin', 'b.bin'].map((name) => listedNamed(name)) })
        let cut: (error: Error) => void = () => {}
        requestRaw.mockImplementation(async (path: string) => {
          const name = path.slice('/api/v2/files/file_'.length)
          if (name === 'a.bin') return new Response(bytesOf(name))
          const half = bytesOf(name).subarray(0, 4)
          return new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(half)
                cut = (error) => controller.error(error)
              },
            })
          )
        })
        // The real handler re-raises the signal, which would end the test runner with it.
        const kill = vi.spyOn(process, 'kill').mockImplementation(() => true)
        const downloadsDir = join(dir, '.sim/downloads')
        const entries = () =>
          existsSync(downloadsDir) ? readdirSync(downloadsDir, { recursive: true }).map(String) : []

        /** The verified downloads kept for the next get: named by a hex digest, at the top. */
        const keptCopies = () => entries().filter((entry) => /^[0-9a-f]{64}$/.test(entry))

        const running = get()
        try {
          await vi.waitFor(() => {
            expect(entries().some((entry) => entry.endsWith('.part'))).toBe(true)
            expect(keptCopies()).toHaveLength(1)
          })
          process.emit('SIGINT')

          expect(kill).toHaveBeenCalledWith(process.pid, 'SIGINT')
          expect(entries().some((entry) => entry.endsWith('.part'))).toBe(false)
          expect(keptCopies()).toHaveLength(1)
          expect(readFileSync(join(downloadsDir, keptCopies()[0]))).toEqual(bytesOf('a.bin'))
        } finally {
          cut(new Error('interrupted'))
          await running.catch(() => {})
          kill.mockRestore()
        }
      })

      it('never reuses a download listed with neither a hash nor a revision', async () => {
        const blobs = NAMES.map((name) => listedNamed(name, { sha256: undefined }))
        serve({}, { kinds: ['file'], blobs })
        downloads('c.bin')
        await expect(get()).rejects.toMatchObject({ status: 429 })

        requestRaw.mockClear()
        downloads(null)
        await get()

        expect(fetchedNames().sort()).toEqual(NAMES)
        expect(existsSync(join(dir, '.sim/downloads'))).toBe(false)
      })
    })

    it('refuses to read a blob through a symbolic link out of the directory', async () => {
      const outside = join(rootDir, 'outside.bin')
      writeFileSync(outside, BYTES)
      mkdirSync(join(dir, 'files'), { recursive: true })
      symlinkSync(outside, join(dir, 'files/report.bin'))

      await expect(
        blobDigests(dir, ['files/report.bin'], { digests: {}, stats: {} })
      ).rejects.toMatchObject({
        code: 'SOURCE_SYMLINK',
      })
      await expect(blobBytes(dir, 'files/report.bin')).rejects.toMatchObject({
        code: 'SOURCE_SYMLINK',
      })
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

    it('refuses to restore a blob deleted since the CLI wrote it, a pending delete', async () => {
      serve({}, { kinds: ['file'], blobs: [listed()] })
      requestRaw.mockImplementation(async () => new Response(BYTES))
      await get()
      rmSync(join(dir, 'files/report.bin'))

      await expect(get()).rejects.toThrow(/edits no apply has saved \(files\/report\.bin\)/)
      expect(existsSync(join(dir, 'files/report.bin'))).toBe(false)

      await get('--force')
      expect(readFileSync(join(dir, 'files/report.bin'))).toEqual(BYTES)
    })

    describe('a same-size edit that kept its modification time (cp -p, rsync -t)', () => {
      const EDITED = Buffer.from([0, 1, 2, 250, 7])

      /** Whole seconds, which every file system and `utimes` hold exactly. */
      const MTIME = 1_700_000_000

      /**
       * Gets the blob twice, so the second records the stat of the file in place, with a
       * modification time `utimes` can put back exactly.
       */
      async function getTwice(): Promise<string> {
        serve({}, { kinds: ['file'], blobs: [listed()], resources: fileResource })
        requestRaw.mockImplementation(async () => new Response(BYTES))
        await get()
        const file = join(dir, 'files/report.bin')
        utimesSync(file, MTIME, MTIME)
        await get()
        const cached = JSON.parse(readFileSync(join(dir, '.sim/cache/stats.json'), 'utf8'))
        expect(cached.stats['files/report.bin']).toBeDefined()
        return file
      }

      /** Rewrites `file` with bytes of the same length and puts its modification time back. */
      function editKeepingMtime(file: string): void {
        writeFileSync(file, EDITED)
        utimesSync(file, MTIME, MTIME)
        expect(statSync(file).mtimeMs).toBe(MTIME * 1000)
      }

      it('refuses to overwrite it', async () => {
        const file = await getTwice()
        editKeepingMtime(file)
        const next = Buffer.from([1, 2, 3])
        serve({}, { kinds: ['file'], blobs: [listed(next)] })
        requestRaw.mockImplementation(async () => new Response(next))

        await expect(get()).rejects.toMatchObject({ code: 'SOURCE_LOCAL_EDITS' })
        expect(readFileSync(file)).toEqual(EDITED)
      })

      it('sends it on apply', async () => {
        editKeepingMtime(await getTwice())
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

        await runWorkspaceSource('apply', dir, '--dry-run', '--allow-delete')

        expect(request.mock.calls[0][1].body.blobs).toEqual([
          {
            path: 'files/report.bin',
            sha256: createHash('sha256').update(EDITED).digest('hex'),
            size: EDITED.length,
          },
        ])
      })
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

      await runWorkspaceSource('apply', dir, '--dry-run', '--allow-delete')

      expect(request.mock.calls[0][1].body.blobs).toEqual([
        { path: 'files/report.bin', sha256: listed().sha256, size: BYTES.length },
      ])
    })
  })

  it('writes a tsconfig whose type-check covers tool and knowledge base declarations', async () => {
    const declaration = (helper: string, body: string) =>
      `// @sim-sdk 1\nimport { ${helper} } from '@sim/workflow-sdk/workspace'\n\nexport default ${helper}(${body})\n`
    serve(
      {
        'tools/lookup.ts': declaration('defineTool', '{ title: 42 }'),
        'knowledge/policies/knowledge.ts': declaration('defineKnowledgeBase', '{ name: 42 }'),
      },
      { kinds: ['custom-tool', 'knowledge-base'] }
    )
    await get()

    const output = typecheckDirectory()
    expect(output).toContain('tools/lookup.ts')
    expect(output).toContain('knowledge/policies/knowledge.ts')
  })

  it('types the skill and custom tool keys the directory declares beside the stored ones', async () => {
    const uses = (skillKey: string) =>
      `// @sim-sdk 1\nimport { agent, customTool, skill, workflow } from '@sim/workflow-sdk'\n\nexport default workflow('Support', {}, () => {\n  agent('Answer', { model: 'claude-sonnet-5-5', tools: [customTool('lookup')], skills: [skill('${skillKey}'), skill('stored')] })\n})\n`
    serve(
      {
        'skills/tone.md': '---\nname: tone\ndescription: Warm\n---\nBe warm.\n',
        'tools/lookup.ts':
          "// @sim-sdk 1\nimport { defineTool } from '@sim/workflow-sdk/workspace'\n\nexport default defineTool({ title: 'Lookup', schema: { type: 'function', function: { name: 'lookup', parameters: { type: 'object', properties: {} } } }, code: '' })\n",
      },
      {
        kinds: ['custom-tool', 'skill'],
        manifest: {
          workspaceId: 'ws_local',
          tables: [],
          knowledgeBases: [],
          credentials: [],
          workflows: [],
          skills: [{ key: 'stored', id: 'skill-1', name: 'stored' }],
          customTools: [],
          env: [],
          truncated: false,
        },
      }
    )
    await get()
    const typecheck = (source: string) => {
      mkdirSync(join(dir, 'workflows/support'), { recursive: true })
      writeFileSync(join(dir, 'workflows/support/workflow.ts'), source)
      return typecheckDirectory()
    }

    expect(typecheck(uses('tone'))).toBe('')
    expect(typecheck(uses('tnoe'))).toContain('"tnoe"')

    writeFileSync(
      join(dir, 'skills/fresh.md'),
      '---\nname: fresh\ndescription: New\n---\nAdded after the get.\n'
    )
    expect(typecheck(uses('fresh'))).toContain('"fresh"')
    contextMockFns.mockProfileFrom.mockReturnValue({ ...mockedProfile(), output: 'json' })
    request.mockClear()
    await runWorkspaceSource('check', dir)
    expect(request).not.toHaveBeenCalled()
    expect(typecheck(uses('fresh'))).toBe('')
    expect(typecheck(uses('tnoe'))).toContain('"tnoe"')
  })

  it("keeps typing a downloaded child workflow's stored inputs in a parent's inputMapping", async () => {
    const child = [
      '// @sim-sdk 1',
      "import { trigger, workflow } from '@sim/workflow-sdk'",
      "export default workflow('Enrich', {}, () => {",
      "  trigger.start('Start', {})",
      '})',
      '',
    ].join('\n')
    serve(
      { 'workflows/enrich/workflow.ts': child },
      {
        kinds: ['workflow'],
        manifest: {
          workspaceId: 'ws_local',
          tables: [],
          knowledgeBases: [],
          credentials: [],
          workflows: [{ key: 'enrich', inputs: [{ name: 'email', type: 'string' }] }],
          skills: [],
          customTools: [],
          env: [],
          truncated: false,
        },
      }
    )
    await get()
    const parent = (field: string) =>
      [
        '// @sim-sdk 1',
        "import { childWorkflow, runWorkflow, trigger, workflow } from '@sim/workflow-sdk'",
        "export default workflow('Parent', {}, () => {",
        "  const start = trigger.start('Start', {})",
        `  start.to(runWorkflow('Run', { workflowId: childWorkflow('enrich'), inputMapping: { ${field}: 'a' } }))`,
        '})',
        '',
      ].join('\n')
    mkdirSync(join(dir, 'workflows/parent'), { recursive: true })
    const typecheck = (field: string) => {
      writeFileSync(join(dir, 'workflows/parent/workflow.ts'), parent(field))
      return typecheckDirectory()
    }

    expect(typecheck('email')).toBe('')
    expect(typecheck('emial')).toContain('emial')
  })

  it.each([
    ['workspaces', (root: string) => runWorkspaceSource('check', root)],
    ['workflows', (root: string) => runWorkflowSourceCheck(join(root, 'workflows/parent'))],
  ])(
    "types a child workflow's inputs edited since the get after a %s check",
    async (_command, check) => {
      const child = (inputs: string) =>
        [
          '// @sim-sdk 1',
          "import { trigger, workflow } from '@sim/workflow-sdk'",
          "export default workflow('Enrich', {}, () => {",
          `  trigger.start('Start', { inputFormat: { ${inputs} } })`,
          '})',
          '',
        ].join('\n')
      serve(
        { 'workflows/enrich/workflow.ts': child("email: 'string'") },
        {
          kinds: ['workflow'],
          manifest: {
            workspaceId: 'ws_local',
            tables: [],
            knowledgeBases: [],
            credentials: [],
            workflows: [{ key: 'enrich', inputs: [{ name: 'email', type: 'string' }] }],
            skills: [],
            customTools: [],
            env: [],
            truncated: false,
          },
        }
      )
      await get()
      const parent = (field: string) =>
        [
          '// @sim-sdk 1',
          "import { childWorkflow, runWorkflow, trigger, workflow } from '@sim/workflow-sdk'",
          "export default workflow('Parent', {}, () => {",
          "  const start = trigger.start('Start', {})",
          `  start.to(runWorkflow('Run', { workflowId: childWorkflow('enrich'), inputMapping: { ${field}: 'a' } }))`,
          '})',
          '',
        ].join('\n')
      mkdirSync(join(dir, 'workflows/parent'), { recursive: true })
      const typecheck = async (inputs: string, field: string) => {
        writeFileSync(join(dir, 'workflows/enrich/workflow.ts'), child(inputs))
        writeFileSync(join(dir, 'workflows/parent/workflow.ts'), parent(field))
        await check(dir)
        return typecheckDirectory()
      }

      expect(await typecheck("email: 'string', phone: 'string'", 'phone')).toBe('')
      expect(await typecheck("email: 'string', phone: 'string'", 'phnoe')).toContain('phnoe')
      expect(await typecheck("phone: 'string'", 'email')).toContain('email')
    }
  )

  it('keeps the block types workflows on disk use when a get refreshes only tables', async () => {
    const notifying = [
      '// @sim-sdk 1',
      "import { slack, trigger, workflow } from '@sim/workflow-sdk'",
      "export default workflow('Notify', {}, () => {",
      "  const start = trigger.start('Start', {})",
      "  const post = slack.sendMessage('Post', { destinationType: 'channel', channel: 'ops', text: 'hi' })",
      '  start.to(post)',
      '})',
      '',
    ].join('\n')
    serve(
      { 'tables/leads.ts': LEADS, 'workflows/notify/workflow.ts': notifying },
      { kinds: ['table', 'workflow'] }
    )
    await get()
    const tsconfig = readFileSync(join(dir, 'tsconfig.json'), 'utf8')
    expect(tsconfig).toContain('.sim/sdk/blocks/slack_v2.d.ts')

    serve({ 'tables/leads.ts': LEADS }, { kinds: ['table'] })
    await get('--only', 'tables')

    expect(readFileSync(join(dir, 'tsconfig.json'), 'utf8')).toBe(tsconfig)
    expect(readFileSync(join(dir, 'workflows/notify/workflow.ts'), 'utf8')).toBe(notifying)
  })

  it('exits 7 when the server refuses the workspace as too large', async () => {
    request.mockRejectedValue(new SimApiError('too many files', 413, 'PAYLOAD_TOO_LARGE'))

    await expect(get()).rejects.toMatchObject({ exitCode: 7 })
  })

  it('reads --only by folder name as well as by kind', async () => {
    serve({}, { kinds: ['custom-tool', 'knowledge-base'] })

    await get('--only', 'tools,knowledge-base,knowledge')

    const call = request.mock.calls.find(([path]) => path === SOURCE_PATH)
    expect(call?.[1].query).toEqual({ kinds: 'custom-tool,knowledge-base' })
    await expect(get('--only', 'gadgets')).rejects.toThrow(/Unknown kind gadgets/)
  })

  it('reads --only past a trailing comma, and refuses one that names no kind', async () => {
    serve({}, { kinds: ['table'] })

    await get('--only', 'tables,')

    const call = request.mock.calls.find(([path]) => path === SOURCE_PATH)
    expect(call?.[1].query).toEqual({ kinds: 'table' })
    await expect(get('--only', ' , ')).rejects.toThrow(/--only names no kind/)
  })

  it('keeps the bytes of workspace files and documents through a git commit and a fresh clone', async () => {
    serve({ 'tables/leads.ts': LEADS })
    await get()
    const crlf = Buffer.from('line one\r\nline two\r\n')
    mkdirSync(join(dir, 'files/notes'), { recursive: true })
    mkdirSync(join(dir, 'knowledge/policies/docs'), { recursive: true })
    for (const path of ['files/notes/a.md', 'files/b.json', 'knowledge/policies/docs/c.md']) {
      writeFileSync(join(dir, path), crlf)
    }
    const git = (cwd: string, ...args: string[]) =>
      execFileSync(
        'git',
        ['-c', 'core.autocrlf=false', '-c', 'user.name=t', '-c', 'user.email=t@t.invalid', ...args],
        { cwd, stdio: 'pipe' }
      )
    git(dir, 'init', '-q')
    git(dir, 'add', '-A')
    git(dir, 'commit', '-q', '-m', 'workspace')
    const clone = join(rootDir, 'clone')
    git(rootDir, 'clone', '-q', dir, clone)

    for (const path of ['files/notes/a.md', 'files/b.json', 'knowledge/policies/docs/c.md']) {
      expect(readFileSync(join(clone, path)).equals(crlf)).toBe(true)
    }
    expect(readFileSync(join(clone, 'tables/leads.ts'), 'utf8')).toBe(LEADS)
    expect(readFileSync(join(dir, '.gitignore'), 'utf8').split('\n')).toEqual(
      expect.arrayContaining(['.sim/downloads/', '.sim/command.lock/', '.sim-staging-*/'])
    )
  })

  it("refreshes the workspace the directory's base names, not the profile's default", async () => {
    serve({ 'tables/leads.ts': LEADS })
    await get()
    const OTHER_SOURCE = '/api/v2/workspaces/ws_other/source'
    const base = JSON.parse(readFileSync(join(dir, '.sim/base.json'), 'utf8'))
    writeFileSync(join(dir, '.sim/base.json'), JSON.stringify({ ...base, workspaceId: 'ws_other' }))
    const served = request.getMockImplementation()
    request.mockImplementation(async (path: string, options: unknown) => {
      if (path === OTHER_SOURCE) {
        return {
          data: {
            workspaceId: 'ws_other',
            kinds: ['table'],
            files: { 'tables/leads.ts': LEADS },
            blobs: [],
            base: { version: 1, workspaceId: 'ws_other', resources: {} },
            skipped: [],
            diagnostics: [],
          },
        }
      }
      if (path === '/api/v2/workspaces/ws_other/workflows/source/catalog') return { data: CATALOG }
      return served?.(path, options)
    })
    request.mockClear()

    await get()

    expect(request.mock.calls.some(([path]) => path === OTHER_SOURCE)).toBe(true)
    expect(request.mock.calls.some(([path]) => path === SOURCE_PATH)).toBe(false)
    expect(JSON.parse(readFileSync(join(dir, '.sim/base.json'), 'utf8')).workspaceId).toBe(
      'ws_other'
    )
  })

  it('refuses a --workspace that differs from the workspace the directory was read from', async () => {
    serve({ 'tables/leads.ts': LEADS })
    await get()
    const base = readFileSync(join(dir, '.sim/base.json'), 'utf8')
    writeFileSync(join(dir, '.sim/base.json'), base.replace('"ws_local"', '"ws_other"'))
    request.mockClear()
    contextMockState.workspaceSource = 'flag'

    await expect(get()).rejects.toMatchObject({ code: 'SOURCE_OTHER_WORKSPACE' })
    expect(request).not.toHaveBeenCalled()
    expect(readFileSync(join(dir, '.sim/base.json'), 'utf8')).toContain('"ws_other"')

    // A base the parser refuses (a field a later CLI added) still names the workspace it binds.
    const extended = JSON.parse(base.replace('"ws_local"', '"ws_other"'))
    writeFileSync(join(dir, '.sim/base.json'), JSON.stringify({ ...extended, later: true }))
    await expect(get()).rejects.toMatchObject({ code: 'SOURCE_OTHER_WORKSPACE' })
    expect(request).not.toHaveBeenCalled()
  })
})

/** Block types the workspace catalog withholds while a stored workflow holds them. */
const WITHHELD_TYPES = new Set(['table_v2', 'knowledge'])

/** {@link CATALOG} as the workspace catalog of a caller it withholds {@link WITHHELD_TYPES} from. */
const WORKSPACE_CATALOG = {
  ...CATALOG,
  hash: 'workspace-catalog',
  blocks: Object.fromEntries(
    Object.entries(CATALOG.blocks).filter(([type]) => !WITHHELD_TYPES.has(type))
  ),
  builders: Object.fromEntries(
    Object.entries(CATALOG.builders as Record<string, { type: string }>).filter(
      ([, builder]) => !WITHHELD_TYPES.has(builder.type)
    )
  ),
}

const ROUTER = `// @sim-sdk 1
import { condition, js, knowledge, knowledgeBase, table, trigger, workflow } from '@sim/workflow-sdk'

export default workflow('Router', {}, () => {
  const start = trigger.start('Start', { inputFormat: { subject: 'string', priority: 'string' } })
  const isUrgent = condition('Is Urgent', { if: js\`\${start.priority} === 'high'\`, else: true })
  const policy = knowledge.search('Policy', {
    knowledgeBaseId: knowledgeBase('policies'),
    query: start.subject,
  })
  const logTicket = table.insertRow('Log Ticket', {
    tableId: table('tickets'),
    data: { subject: start.subject },
  })

  start.to(isUrgent)
  isUrgent.if.to(policy)
  isUrgent.else.to(logTicket)
})
`

/** A stored cycle between A and B, every block bound by the lock. */
const CYCLE = `// @sim-sdk 1
import { api, trigger, workflow } from '@sim/workflow-sdk'

export default workflow('Cycle', {}, () => {
  const start = trigger.start('Start', {})
  const a = api('A', { url: 'https://example.com', method: 'GET' })
  const b = api('B', { url: 'https://example.com', method: 'GET' })
  const c = api('C', { url: 'https://example.com', method: 'GET' })

  start.to(a)
  a.to(b)
  b.to(a)
  b.to(c)
})
`

function lockOf(keys: readonly string[]): string {
  return JSON.stringify({
    version: 1,
    blocks: Object.fromEntries(
      keys.map((key, order) => [key, { id: `id-${key}`, parent: null, ident: key, order }])
    ),
    variables: {},
  })
}

/**
 * A workspace answer holding workflow `key` (`source`, bound by a lock on `keys`) printed with
 * the catalog of hash `catalogHash`; the catalog route answers the full catalog for a workflow and
 * the withholding one for the workspace.
 */
function serveWorkflow(key: string, source: string, keys: readonly string[], catalogHash: string) {
  const files = {
    [`workflows/${key}/workflow.ts`]: source,
    [`workflows/${key}/.sim/lock.json`]: lockOf(keys),
    [`workflows/${key}/.sim/base.json`]: JSON.stringify({
      version: 1,
      workflowId: `wf-${key}`,
      workspaceId: 'ws_local',
      fingerprint: `sf1:${key}`,
      catalogHash,
    }),
  }
  serve(files, {
    kinds: ['workflow'],
    resources: { [`workflow:${key}`]: { id: `wf-${key}`, fingerprint: `rf1:${key}` } },
  })
  const answer = request.getMockImplementation()
  request.mockImplementation(
    async (path: string, options?: { query?: { workflowId?: string } }) => {
      if (path !== CATALOG_PATH) return answer?.(path, options)
      return { data: options?.query?.workflowId ? CATALOG : WORKSPACE_CATALOG }
    }
  )
}

function checked(): { errors: number; diagnostics: Array<{ code: string }> } {
  return JSON.parse(vi.mocked(console.log).mock.calls.at(-1)?.join(' ') ?? '{}')
}

describe('workspaces source check after a get', () => {
  afterEach(() => {
    process.exitCode = undefined
  })

  it('checks a workflow holding a type the workspace catalog withholds against its own catalog', async () => {
    serveWorkflow('router', ROUTER, ['start', 'isurgent', 'policy', 'logticket'], CATALOG.hash)
    await get()

    await runWorkspaceSource('check', dir)

    expect(checked()).toMatchObject({ errors: 0, diagnostics: [] })
    expect(existsSync(join(dir, 'workflows/router/.sim/stored-edges.json'))).toBe(true)
    expect((await kindFolders(dir, ['workflow'])).ignored).toEqual([])
    expect(
      request.mock.calls.filter(
        ([path, options]) => path === CATALOG_PATH && options?.query?.workflowId === 'wf-router'
      )
    ).toHaveLength(1)
  })

  it('refuses a cycle an edit closes between bound blocks of a workflow folder', async () => {
    serveWorkflow('cycle', CYCLE, ['start', 'a', 'b', 'c'], WORKSPACE_CATALOG.hash)
    await get()
    await runWorkspaceSource('check', dir, '--strict')
    expect(checked().diagnostics.map(({ code }) => code)).toEqual(['W_EDGE_CYCLE'])
    expect(process.exitCode).toBeUndefined()
    const entry = join(dir, 'workflows/cycle/workflow.ts')
    writeFileSync(
      entry,
      readFileSync(entry, 'utf8').replace('  b.to(c)\n', '  b.to(c)\n  c.to(b)\n')
    )

    await runWorkspaceSource('check', dir, '--strict')

    expect(checked().diagnostics.map(({ code }) => code)).toEqual(['E_EDGE_CYCLE'])
    expect(process.exitCode).toBe(1)
  })
})
