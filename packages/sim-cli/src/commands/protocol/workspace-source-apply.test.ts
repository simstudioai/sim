import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  truncateSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { WORKSPACE_SOURCE_LIMITS } from '@sim/workspace-code/limits'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SimApiError } from '../../http/client'
import { contextMockFns, contextMockState } from '../../test/context-mock'
import { runWorkspaceSource } from '../../test/workspace-source-command'
import { digest } from './source-dir'

vi.mock('../../context', async () => (await import('../../test/context-mock')).contextMock)

const { mockRequest } = contextMockFns

/** The apply calls: every request but the staging ones, which {@link staging} answers. */
const request = vi.fn()

/** The server's staging area for the caller: hashes held, and every staging call made. */
const staging = {
  held: new Set<string>(),
  asked: [] as string[][],
  uploaded: [] as string[][],
}

/** Answers the staging calls as the server would, from {@link staging}. */
async function stagingAnswer(path: string, options: { body?: unknown; form?: FormData }) {
  if (path.endsWith('/source/blobs/missing')) {
    const { blobs } = options.body as { blobs: Array<{ sha256: string }> }
    staging.asked.push(blobs.map((blob) => blob.sha256))
    return {
      data: {
        workspaceId: 'ws_local',
        missing: blobs.map((blob) => blob.sha256).filter((sha256) => !staging.held.has(sha256)),
      },
    }
  }
  const sent: string[] = []
  for (const [sha256, value] of options.form?.entries() ?? []) {
    const bytes = Buffer.from(await (value as File).arrayBuffer())
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(sha256)
    sent.push(sha256)
    staging.held.add(sha256)
  }
  staging.uploaded.push(sent)
  return { data: { workspaceId: 'ws_local', staged: [] } }
}

const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex')

const BASE = { version: 1, workspaceId: 'ws_local', resources: {} }
const LEADS = "// @sim-sdk 1\nexport default defineTable({ name: 'leads', columns: {} })\n"
const INGEST = "// @sim-sdk 1\nexport default workflow('Ingest', {}, () => {})\n"
/** A workflow folder's base, as a get in `workspaceId` writes it. */
const folderBase = (workspaceId: string) =>
  JSON.stringify({ workflowId: 'wf_1', workspaceId, fingerprint: 'sf1:a', catalogHash: 'c' })
const INGEST_BASE = folderBase('ws_local')

function answer(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      workspaceId: 'ws_local',
      dryRun: false,
      plan: [],
      applied: [],
      needBlobs: [],
      files: {},
      base: BASE,
      diagnostics: [],
      ...overrides,
    },
  }
}

let dir: string

function write(path: string, text: string | Buffer) {
  mkdirSync(dirname(join(dir, path)), { recursive: true })
  writeFileSync(join(dir, path), text)
}

function apply(...argv: string[]): Promise<void> {
  return runWorkspaceSource('apply', dir, ...argv)
}

function bodies(): Array<{
  files: Record<string, string>
  blobs?: Array<{ path: string; sha256: string; size: number }>
}> {
  return request.mock.calls.map((call) => call[1].body)
}

beforeEach(() => {
  contextMockState.output = 'json'
  contextMockState.workspaceSource = 'config'
  request.mockReset()
  mockRequest.mockReset()
  mockRequest.mockImplementation((path: string, options: { body?: unknown; form?: FormData }) =>
    path.includes('/source/blobs') ? stagingAnswer(path, options) : request(path, options)
  )
  staging.held.clear()
  staging.asked.length = 0
  staging.uploaded.length = 0
  dir = mkdtempSync(join(tmpdir(), 'sim-workspace-apply-'))
  write('.sim/base.json', JSON.stringify(BASE))
  write('tables/leads.ts', LEADS)
  write('workflows/ingest/workflow.ts', INGEST)
  write('workflows/ingest/.sim/base.json', INGEST_BASE)
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  process.exitCode = undefined
  rmSync(dir, { recursive: true, force: true })
})

describe('workspaces source apply', () => {
  it('sends a workflow folder whole only when it was edited since the CLI wrote it', async () => {
    write(
      '.sim/written.json',
      JSON.stringify({
        files: {
          'workflows/ingest/workflow.ts': digest(INGEST),
          'workflows/ingest/.sim/base.json': digest(INGEST_BASE),
        },
      })
    )
    request.mockResolvedValue(answer())

    await apply('--yes')

    expect(Object.keys(bodies()[0].files).sort()).toEqual([
      'tables/leads.ts',
      'workflows/ingest/.sim/base.json',
    ])

    write('workflows/ingest/workflow.ts', `${INGEST}// edited\n`)
    request.mockClear()
    await apply('--yes')

    expect(Object.keys(bodies()[0].files)).toContain('workflows/ingest/workflow.ts')
  })

  it('sends an unchanged workflow folder whole when applying a copy to another workspace', async () => {
    const copied = folderBase('ws_other')
    write('.sim/base.json', JSON.stringify({ ...BASE, workspaceId: 'ws_other' }))
    write('workflows/ingest/.sim/base.json', copied)
    write(
      '.sim/written.json',
      JSON.stringify({
        files: {
          'workflows/ingest/workflow.ts': digest(INGEST),
          'workflows/ingest/.sim/base.json': digest(copied),
        },
      })
    )
    contextMockState.workspaceSource = 'flag'
    request.mockResolvedValue(answer())

    await apply('--yes')

    expect(bodies()[0].files['workflows/ingest/workflow.ts']).toBe(INGEST)
  })

  it('removes the function files an applied workflow no longer uses, keeping files no lock named', async () => {
    const lock = (codeFiles: string[]) =>
      `${JSON.stringify({ version: 1, blocks: Object.fromEntries(codeFiles.map((file, index) => [`b${index}`, { id: `blk_${index}`, codeFile: file }])), variables: {} })}\n`
    write('workflows/ingest/.sim/lock.json', lock(['functions/score.js', 'functions/old.js']))
    write('workflows/ingest/functions/score.js', 'return 1\n')
    write('workflows/ingest/functions/old.js', 'return 2\n')
    write('workflows/ingest/functions/mine.js', 'return 3\n')
    request.mockResolvedValue(
      answer({
        applied: [{ kind: 'workflow', key: 'ingest', action: 'update', id: 'wf_1' }],
        files: {
          'workflows/ingest/workflow.ts': INGEST,
          'workflows/ingest/functions/score.js': 'return 1\n',
          'workflows/ingest/.sim/lock.json': lock(['functions/score.js']),
          'workflows/ingest/.sim/base.json': '{}\n',
        },
      })
    )

    await apply('--yes')

    expect(existsSync(join(dir, 'workflows/ingest/functions/old.js'))).toBe(false)
    expect(existsSync(join(dir, 'workflows/ingest/functions/score.js'))).toBe(true)
    expect(existsSync(join(dir, 'workflows/ingest/functions/mine.js'))).toBe(true)
    const written = JSON.parse(readFileSync(join(dir, '.sim/written.json'), 'utf8')).files
    expect(Object.keys(written)).not.toContain('workflows/ingest/functions/old.js')
  })

  it('keeps every function file of a workflow whose new lock does not read as one', async () => {
    write(
      'workflows/ingest/.sim/lock.json',
      `${JSON.stringify({ version: 1, blocks: { b0: { id: 'blk_0', codeFile: 'functions/score.js' } }, variables: {} })}\n`
    )
    write('workflows/ingest/functions/score.js', 'return 1\n')
    request.mockResolvedValue(
      answer({
        applied: [{ kind: 'workflow', key: 'ingest', action: 'update', id: 'wf_1' }],
        files: {
          'workflows/ingest/workflow.ts': INGEST,
          'workflows/ingest/.sim/lock.json': '{ not json',
          'workflows/ingest/.sim/base.json': '{}\n',
        },
      })
    )

    await apply('--yes')

    expect(existsSync(join(dir, 'workflows/ingest/functions/score.js'))).toBe(true)
  })

  it('saves what a part-way apply wrote and exits 8', async () => {
    request.mockResolvedValue(
      answer({
        plan: [
          { kind: 'table', key: 'leads', action: 'create' },
          { kind: 'workflow', key: 'ingest', action: 'create' },
        ],
        applied: [{ kind: 'table', key: 'leads', action: 'create', id: 'tbl_1' }],
        failed: { kind: 'workflow', key: 'ingest', code: 'E_APPLY_FAILED', message: 'failed' },
        files: { 'tables/leads.ts': `${LEADS}// stored\n` },
        base: { ...BASE, resources: { 'table:leads': { id: 'tbl_1' } } },
      })
    )

    await apply('--yes')

    expect(process.exitCode).toBe(8)
    const printed = vi
      .mocked(console.log)
      .mock.calls.map(([line]) => String(line))
      .join('\n')
    expect(JSON.parse(printed)).toMatchObject({ applied: 1, created: 1, failed: 'workflow:ingest' })
    expect(readFileSync(join(dir, 'tables/leads.ts'), 'utf8')).toBe(`${LEADS}// stored\n`)
    expect(JSON.parse(readFileSync(join(dir, '.sim/base.json'), 'utf8')).resources).toEqual({
      'table:leads': { id: 'tbl_1' },
    })
  })

  it('stages only the blobs the base does not hold, then applies once naming them by hash', async () => {
    write('files/a.bin', Buffer.from([1, 2, 3]))
    write('files/b.bin', Buffer.from([4, 5]))
    write(
      '.sim/base.json',
      JSON.stringify({
        ...BASE,
        resources: {
          'file:a.bin': {
            id: 'f1',
            blobs: { 'files/a.bin': { id: 'f1', rev: 1, sha256: sha(Buffer.from([1, 2, 3])) } },
          },
        },
      })
    )
    request.mockResolvedValueOnce(answer())

    await apply('--yes')

    expect(staging.asked).toEqual([[sha(Buffer.from([4, 5]))]])
    expect(staging.uploaded).toEqual([[sha(Buffer.from([4, 5]))]])
    expect(request).toHaveBeenCalledTimes(1)
    expect(bodies()[0].blobs).toEqual([
      { path: 'files/a.bin', sha256: sha(Buffer.from([1, 2, 3])), size: 3 },
      { path: 'files/b.bin', sha256: sha(Buffer.from([4, 5])), size: 2 },
    ])
    expect(request.mock.calls.every((call) => call[1].query === undefined)).toBe(true)
  })

  it('a resumed apply uploads only the blobs not already staged', async () => {
    write('files/a.bin', Buffer.from([1, 2, 3]))
    write('files/b.bin', Buffer.from([4, 5]))
    staging.held.add(sha(Buffer.from([1, 2, 3])))
    request.mockResolvedValueOnce(answer())

    await apply('--yes')

    expect(staging.asked[0]?.sort()).toEqual(
      [sha(Buffer.from([1, 2, 3])), sha(Buffer.from([4, 5]))].sort()
    )
    expect(staging.uploaded).toEqual([[sha(Buffer.from([4, 5]))]])
  })

  it('stages what a refusal names as missing and applies once more; any other refusal stands', async () => {
    write('files/a.bin', Buffer.from([1, 2, 3]))
    write(
      '.sim/base.json',
      JSON.stringify({
        ...BASE,
        resources: {
          'file:a.bin': {
            id: 'f1',
            blobs: { 'files/a.bin': { id: 'f1', rev: 1, sha256: sha(Buffer.from([1, 2, 3])) } },
          },
        },
      })
    )
    const missing = new SimApiError('Rejected', 400, 'SOURCE_REJECTED', {
      code: 'SOURCE_REJECTED',
      diagnostics: [
        { code: 'E_BLOB_MISSING', severity: 'error', message: 'missing', file: 'files/a.bin' },
      ],
    })
    request.mockRejectedValueOnce(missing).mockResolvedValueOnce(answer())

    await apply('--yes')

    expect(staging.uploaded).toEqual([[sha(Buffer.from([1, 2, 3]))]])
    expect(request).toHaveBeenCalledTimes(2)

    request.mockReset()
    request.mockRejectedValue(missing)
    await expect(apply('--yes')).rejects.toMatchObject({ status: 400 })
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('refuses a blob that changed after it was hashed, before staging or applying it', async () => {
    write('files/a.bin', Buffer.from([1, 2, 3]))
    mockRequest.mockImplementation(async (path: string, options: { body?: unknown }) => {
      if (path.endsWith('/source/blobs/missing')) write('files/a.bin', Buffer.from([9, 9, 9]))
      return stagingAnswer(path, options)
    })

    await expect(apply('--yes')).rejects.toMatchObject({ code: 'SOURCE_BLOB_CHANGED' })
    expect(staging.uploaded).toEqual([])
    expect(request).not.toHaveBeenCalled()
  })

  describe('rate limiting', () => {
    const limited = () =>
      new SimApiError('API rate limit exceeded', 429, 'RATE_LIMITED', undefined, 9)

    beforeEach(() => {
      write('files/a.bin', Buffer.from([1, 2, 3]))
      write('files/b.bin', Buffer.from([4, 5]))
    })

    it('a 429 while staging writes nothing and keeps the rate-limit exit; the rerun skips what landed', async () => {
      let uploads = 0
      mockRequest.mockImplementation(
        async (path: string, options: { body?: unknown; form?: FormData }) => {
          if (path.endsWith('/source/blobs') && ++uploads === 1) {
            await stagingAnswer(path, options)
            throw limited()
          }
          return path.includes('/source/blobs')
            ? stagingAnswer(path, options)
            : request(path, options)
        }
      )
      request.mockResolvedValue(answer())

      await expect(apply('--yes')).rejects.toMatchObject({ status: 429, exitCode: 9 })
      expect(request).not.toHaveBeenCalled()
      expect(existsSync(join(dir, '.sim/written.json'))).toBe(false)

      await apply('--yes')
      expect(staging.uploaded).toHaveLength(1)
      expect(request).toHaveBeenCalledTimes(1)
    })

    it('a 429 on the apply, which wrote nothing, keeps the rate-limit exit', async () => {
      request.mockRejectedValueOnce(limited())

      await expect(apply('--yes')).rejects.toMatchObject({ status: 429, exitCode: 9 })
      expect(existsSync(join(dir, '.sim/written.json'))).toBe(false)
    })

    it('marks the dry run, the apply and every staging call as safe to resend after a 429', async () => {
      request
        .mockResolvedValueOnce(answer({ dryRun: true, needBlobs: ['files/a.bin'] }))
        .mockResolvedValueOnce(answer())

      await apply('--dry-run')
      await apply('--yes')

      expect(request).toHaveBeenCalledTimes(2)
      expect(mockRequest).toHaveBeenCalledTimes(4)
      for (const call of mockRequest.mock.calls) expect(call[1].retryRateLimited).toBe(true)
    })
  })

  it('reuses a recorded blob digest while the file keeps its size and modification time', async () => {
    const file = join(dir, 'files/a.bin')
    write('files/a.bin', Buffer.from([1, 2, 3]))
    utimesSync(file, 1000, 1000)
    const held = createHash('sha256')
      .update(Buffer.from([1, 2, 3]))
      .digest('hex')
    const base = {
      ...BASE,
      resources: {
        'file:a.bin': { id: 'f1', blobs: { 'files/a.bin': { id: 'f1', rev: '1', sha256: held } } },
      },
    }
    request.mockResolvedValue(answer({ base }))
    await apply('--yes')
    const sentDigest = () => request.mock.lastCall?.[1].body.blobs?.[0]?.sha256

    // Same size and modification time: the recorded digest stands, the file is not read.
    write('files/a.bin', Buffer.from([7, 8, 9]))
    utimesSync(file, 1000, 1000)
    await apply('--yes')
    expect(sentDigest()).toBe(held)

    // A new modification time: the file is read again.
    utimesSync(file, 2000, 2000)
    await apply('--yes')
    expect(sentDigest()).toBe(
      createHash('sha256')
        .update(Buffer.from([7, 8, 9]))
        .digest('hex')
    )
  })

  it('names the way back when a write ends without an answer, but not for a refusal', async () => {
    request.mockRejectedValueOnce(
      new SimApiError('https://sim.test did not answer within 3600s.', 0)
    )
    await expect(apply('--yes')).rejects.toThrow(`sim workspaces source get --dir ${dir} --force`)

    request.mockRejectedValueOnce(new SimApiError('Refused.', 400, 'BAD_REQUEST'))
    await expect(apply('--yes')).rejects.toThrow(/^Refused\.$/)
  })

  it('refuses a server answer naming a path outside the kind folders', async () => {
    request.mockResolvedValue(answer({ files: { '.git/hooks/pre-commit': 'rm -rf /' } }))

    await expect(apply('--yes')).rejects.toThrow(/unsafe file path/)
  })

  it('refuses a directory read from another workspace unless --workspace names the target', async () => {
    write('.sim/base.json', JSON.stringify({ ...BASE, workspaceId: 'ws_other' }))
    request.mockResolvedValue(answer())

    await expect(apply('--yes')).rejects.toMatchObject({ code: 'SOURCE_OTHER_WORKSPACE' })
    expect(request).not.toHaveBeenCalled()

    contextMockState.workspaceSource = 'flag'
    await apply('--yes')

    expect(request).toHaveBeenCalledTimes(1)
  })

  it('refuses a base that records blobs no get downloaded, but sends one the user removed', async () => {
    const sha256 = 'a'.repeat(64)
    write(
      '.sim/base.json',
      JSON.stringify({
        ...BASE,
        resources: {
          'file:a.bin': { id: 'f1', blobs: { 'files/a.bin': { id: 'f1', rev: 1, sha256 } } },
          'knowledge-base:docs': {
            id: 'kb1',
            blobs: { 'guide.pdf': { id: 'd1', rev: 1, sha256 } },
          },
        },
      })
    )
    write('files/.gitkeep', '')
    write('knowledge/.gitkeep', '')
    request.mockResolvedValue(answer())

    await expect(apply('--yes', '--allow-delete')).rejects.toMatchObject({
      code: 'SOURCE_BLOBS_NOT_FETCHED',
      message: expect.stringContaining('files/a.bin, knowledge/docs/docs/guide.pdf'),
    })
    expect(request).not.toHaveBeenCalled()

    write(
      '.sim/written.json',
      JSON.stringify({ files: { 'files/a.bin': sha256, 'knowledge/docs/docs/guide.pdf': sha256 } })
    )
    await apply('--yes', '--allow-delete')

    expect(request).toHaveBeenCalled()
  })

  it('records the blobs an apply uploaded, so removing one later deletes it', async () => {
    const sha256 = createHash('sha256').update('hello').digest('hex')
    const other = createHash('sha256').update('stale').digest('hex')
    write('files/a.txt', 'hello')
    write('files/b.txt', 'hello')
    write('knowledge/docs/knowledge.ts', '// @sim-sdk 1\n')
    write('knowledge/docs/docs/guide.md', 'hello')
    const after = {
      ...BASE,
      resources: {
        'file:a.txt': { id: 'f1', blobs: { 'files/a.txt': { id: 'f1', rev: '1', sha256 } } },
        'file:b.txt': { id: 'f2', blobs: { 'files/b.txt': { id: 'f2', rev: '1', sha256: other } } },
        'knowledge-base:docs': {
          id: 'kb1',
          blobs: { 'guide.md': { id: 'd1', rev: '1', sha256 } },
        },
      },
    }
    request.mockResolvedValue(answer({ base: after }))

    await apply('--yes')

    expect(JSON.parse(readFileSync(join(dir, '.sim/written.json'), 'utf8')).files).toEqual({
      'files/a.txt': sha256,
      'knowledge/docs/docs/guide.md': sha256,
    })
    unlinkSync(join(dir, 'files/a.txt'))
    unlinkSync(join(dir, 'knowledge/docs/docs/guide.md'))
    write('files/b.txt', 'stale')
    await expect(apply('--yes', '--allow-delete')).resolves.toBeUndefined()
  })

  it.each([
    [['E_APPLY_LOCKED'], 6],
    [['E_PLAN_TOO_LARGE'], 7],
    [['E_LIMIT_EXCEEDED'], 7],
    [['E_LIMIT_EXCEEDED', 'E_APPLY_LOCKED', 'E_APPLY_STALE'], 5],
    [['E_DECL_SHAPE'], 1],
  ])('exits on a refused dry run as a commit refusing %j would', async (codes, exitCode) => {
    request.mockResolvedValue(
      answer({
        dryRun: true,
        diagnostics: codes.map((code) => ({ code, severity: 'error', message: code })),
      })
    )

    await apply('--dry-run')

    expect(process.exitCode).toBe(exitCode)
  })

  it('refuses a local blob over the size limit before reading it, and exits 7', async () => {
    write('files/huge.bin', '')
    truncateSync(join(dir, 'files/huge.bin'), WORKSPACE_SOURCE_LIMITS.maxBlobBytes + 1)
    request.mockResolvedValue(answer())

    await expect(apply('--yes')).rejects.toMatchObject({
      exitCode: 7,
      message: expect.stringContaining('files/huge.bin'),
    })
    expect(request).not.toHaveBeenCalled()
  })

  it('warns that a hidden file under a kind folder is not sent', async () => {
    write('files/.gitkeep', '')
    write('files/.env', 'SECRET=1')
    write('files/notes.md', 'hi')
    request.mockResolvedValue(answer())

    await apply('--yes')

    expect(bodies()[0].blobs?.map((blob) => blob.path)).toEqual(['files/notes.md'])
    const warned = vi
      .mocked(console.error)
      .mock.calls.map(([line]) => String(line))
      .join('\n')
    expect(warned).toContain('files/.env')
    expect(warned).not.toContain('files/.gitkeep')
  })

  it('sends secrets.ts and credentials.ts as their kinds, and no other root file', async () => {
    const secrets =
      "// @sim-sdk 1\nexport default defineSecrets({ OPENAI_API_KEY: { description: 'Models' } })\n"
    write('secrets.ts', secrets)
    write('credentials.ts', '// @sim-sdk 1\nexport default defineCredentials({})\n')
    write('notes.ts', 'export {}\n')
    request.mockResolvedValue(answer())

    await apply('--yes')

    const body = request.mock.calls[0][1].body
    expect(body.kinds).toEqual(['secret', 'credential', 'table', 'workflow'])
    expect(body.files['secrets.ts']).toBe(secrets)
    expect(Object.keys(body.files)).toContain('credentials.ts')
    expect(Object.keys(body.files)).not.toContain('notes.ts')
  })

  it('saves what an apply wrote around the changes it held back, and exits 1', async () => {
    request.mockResolvedValue(
      answer({
        plan: [
          { kind: 'table', key: 'leads', action: 'create' },
          { kind: 'workflow', key: 'ingest', action: 'create', held: true },
        ],
        applied: [{ kind: 'table', key: 'leads', action: 'create', id: 'tbl_1' }],
        files: { 'tables/leads.ts': `${LEADS}// stored\n` },
        base: { ...BASE, resources: { 'table:leads': { id: 'tbl_1' } } },
        diagnostics: [
          {
            code: 'E_SECRET_MISSING',
            severity: 'error',
            message: 'workflows/ingest is held back: it reads the secret OPENAI_API_KEY.',
            hint: 'Set it with `sim secrets set OPENAI_API_KEY --scope workspace`.',
            kind: 'workflow',
            key: 'ingest',
          },
        ],
      })
    )

    await apply('--yes')

    expect(process.exitCode).toBe(1)
    const printed = vi
      .mocked(console.log)
      .mock.calls.map(([line]) => String(line))
      .join('\n')
    expect(JSON.parse(printed)).toMatchObject({ applied: 1, held: 1, errors: 1 })
    expect(readFileSync(join(dir, 'tables/leads.ts'), 'utf8')).toBe(`${LEADS}// stored\n`)
    const warned = vi
      .mocked(console.error)
      .mock.calls.map(([line]) => String(line))
      .join('\n')
    expect(warned).toContain('Held back, not written: workflow ingest')
  })
})
