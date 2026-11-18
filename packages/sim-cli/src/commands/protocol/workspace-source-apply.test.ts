import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  truncateSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { WORKSPACE_SOURCE_LIMITS } from '@sim/workspace-code/limits'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { contextMockFns, contextMockState } from '../../test/context-mock'
import { runWorkspaceSource } from '../../test/workspace-source-command'
import { digest } from './source-dir'

vi.mock('../../context', async () => (await import('../../test/context-mock')).contextMock)

const { mockRequest: request } = contextMockFns

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
      remainingBlobs: [],
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
  blobs?: Array<{ path: string; content?: string }>
}> {
  return request.mock.calls.map((call) => call[1].body)
}

beforeEach(() => {
  contextMockState.output = 'json'
  contextMockState.workspaceSource = 'config'
  request.mockReset()
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

  it('sends blob content in rounds, only for the paths the server asks for', async () => {
    write('files/a.bin', Buffer.from([1, 2, 3]))
    write('files/b.bin', Buffer.from([4, 5]))
    request
      .mockResolvedValueOnce(answer({ dryRun: true, needBlobs: ['files/a.bin', 'files/b.bin'] }))
      .mockResolvedValueOnce(answer({ remainingBlobs: ['files/b.bin'] }))
      .mockResolvedValueOnce(answer())

    await apply('--yes')

    const sent = bodies().map((body) =>
      (body.blobs ?? []).filter((blob) => blob.content !== undefined).map((blob) => blob.path)
    )
    expect(sent).toEqual([[], ['files/a.bin', 'files/b.bin'], ['files/b.bin']])
    expect(request).toHaveBeenCalledTimes(3)
  })

  it('stops when a round makes no progress instead of looping', async () => {
    write('files/a.bin', Buffer.from([1]))
    request
      .mockResolvedValueOnce(answer({ dryRun: true, needBlobs: ['files/a.bin'] }))
      .mockResolvedValue(answer({ remainingBlobs: ['files/a.bin'] }))

    await expect(apply('--yes')).rejects.toThrow(/did not accept the binary files/)
    expect(request).toHaveBeenCalledTimes(2)
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
    const needBlobs = ['files/a.txt', 'files/b.txt', 'knowledge/docs/docs/guide.md']
    request
      .mockResolvedValueOnce(answer({ dryRun: true, needBlobs }))
      .mockResolvedValue(answer({ base: after }))

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
})
