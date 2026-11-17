import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { contextMockFns, contextMockState } from '../../test/context-mock'
import { digest } from './workflow-source-layout'
import { attachWorkspaceSourceApply } from './workspace-source-apply'

vi.mock('../../context', async () => (await import('../../test/context-mock')).contextMock)

const { mockRequest: request } = contextMockFns

const BASE = { version: 1, workspaceId: 'ws_local', resources: {} }
const LEADS = "// @sim-sdk 1\nexport default defineTable({ name: 'leads', columns: {} })\n"
const INGEST = "// @sim-sdk 1\nexport default workflow('Ingest', {}, () => {})\n"

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

async function apply(...argv: string[]): Promise<void> {
  const root = new Command('sim')
  attachWorkspaceSourceApply(root.command('workspaces').command('source'))
  root.exitOverride()
  await root.parseAsync(['node', 'sim', 'workspaces', 'source', 'apply', '--dir', dir, ...argv])
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
  write('workflows/ingest/.sim/base.json', '{}')
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
          'workflows/ingest/.sim/base.json': digest('{}'),
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

  it('saves what a part-way apply wrote and exits 8', async () => {
    request.mockResolvedValue(
      answer({
        applied: [{ kind: 'table', key: 'leads', action: 'create', id: 'tbl_1' }],
        failed: { kind: 'workflow', key: 'ingest', code: 'E_APPLY_FAILED', message: 'failed' },
        files: { 'tables/leads.ts': `${LEADS}// stored\n` },
        base: { ...BASE, resources: { 'table:leads': { id: 'tbl_1' } } },
      })
    )

    await apply('--yes')

    expect(process.exitCode).toBe(8)
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
})
