import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { REQUEST_CANCELLED, SimApiError } from '../../http/client'
import { contextMockFns, contextMockState, mockedProfile } from '../../test/context-mock'
import { digest } from './source-dir'
import { attachWorkflowSourceDiff, attachWorkflowSourceStatus } from './workflow-source-status'

vi.mock('../../context', async () => (await import('../../test/context-mock')).contextMock)

const { mockRequest, mockProfileFrom } = contextMockFns

const WORKFLOW_ID = '00000000-0000-4000-8000-00000000000a'
const WORKSPACE_ID = 'ws_local'
const BASE = {
  workflowId: WORKFLOW_ID,
  workspaceId: WORKSPACE_ID,
  fingerprint: 'sf1:a',
  catalogHash: 'h',
}
const LOCK = {
  version: 1,
  blocks: {
    score: { id: 'b-0', parent: null, ident: 'score', order: 0, codeFile: 'functions/score.js' },
  },
  variables: {},
}
const ENTRY =
  "// @sim-sdk 1\nimport { codeFile, fn, workflow } from '@sim/workflow-sdk'\n\nexport default workflow('W', {}, () => {\n  fn('Score', { code: codeFile('./functions/score.js') })\n})\n"
const SCORE = 'return 1\n'
const GOT: Record<string, string> = { 'workflow.ts': ENTRY, 'functions/score.js': SCORE }

let root: string

function write(base: string, path: string, text: string) {
  mkdirSync(dirname(join(base, path)), { recursive: true })
  writeFileSync(join(base, path), text)
}

/** Writes a workflow directory as a get leaves it, its record at `record` (the directory's own). */
function writeWorkflowDir(dir: string, record: { at: string; prefix: string } | null) {
  for (const [path, text] of Object.entries(GOT)) write(dir, path, text)
  write(dir, '.sim/lock.json', JSON.stringify(LOCK))
  write(dir, '.sim/base.json', JSON.stringify(BASE))
  const digests = Object.fromEntries(
    Object.entries(GOT).map(([path, text]) => [`${record?.prefix ?? ''}${path}`, digest(text)])
  )
  write(record?.at ?? dir, '.sim/written.json', JSON.stringify({ version: 1, files: digests }))
}

async function run(dir: string, command: 'status' | 'diff', ...argv: string[]): Promise<void> {
  const source = new Command('source')
  attachWorkflowSourceStatus(source)
  attachWorkflowSourceDiff(source)
  source.exitOverride()
  for (const each of source.commands) each.exitOverride()
  await source.parseAsync(['node', 'source', command, '--dir', dir, ...argv])
}

function printed(): Record<string, unknown> {
  return JSON.parse(vi.mocked(console.log).mock.calls.at(-1)?.join(' ') ?? '{}')
}

/** A dry run's answer: the graph diff and the findings. */
function dryRun(diagnostics: Array<Record<string, unknown>> = [], modified = 0) {
  return {
    data: {
      workflowId: WORKFLOW_ID,
      workspaceId: WORKSPACE_ID,
      dryRun: true,
      applied: false,
      diff: {
        noop: modified === 0,
        blocks: {
          added: [],
          removed: [],
          renamed: [],
          modified: Array.from({ length: modified }, () => ({
            id: 'b-0',
            key: 'score',
            fields: ['code'],
          })),
        },
        edges: { added: 0, removed: 0 },
        variables: { added: [], removed: [], renamed: [], modified: [] },
      },
      diagnostics,
      files: GOT,
      lock: LOCK,
      base: BASE,
      mintedIds: {},
      notes: [],
      needsRedeployment: false,
    },
  }
}

const STALE = { code: 'E_APPLY_STALE', severity: 'error', message: 'The workflow changed.' }

beforeEach(() => {
  contextMockState.output = 'json'
  mockRequest.mockReset()
  mockProfileFrom.mockReturnValue({ ...mockedProfile(), workspaceId: WORKSPACE_ID, output: 'json' })
  root = mkdtempSync(join(tmpdir(), 'sim-workflow-status-'))
  writeWorkflowDir(root, null)
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  process.exitCode = undefined
  rmSync(root, { recursive: true, force: true })
})

describe('workflows source status', () => {
  it.each(['status', 'diff'] as const)(
    'on a starter no workflow was created from, %s names the create to run, not a get',
    async (command) => {
      const starter = join(root, 'starter')
      write(starter, 'workflow.ts', GOT['workflow.ts'])
      write(starter, '.sim/starter.json', JSON.stringify({ workspaceId: WORKSPACE_ID }))

      await expect(run(starter, command)).rejects.toThrow(
        `It holds a starter no workflow was created from yet: run \`sim workflows source create --dir ${starter} --workspace ${WORKSPACE_ID} --dry-run\``
      )
      expect(mockRequest).not.toHaveBeenCalled()
    }
  )

  it('is clean, exit 0, with nothing changed on either side', async () => {
    mockRequest.mockResolvedValue(dryRun())

    await run(root, 'status')

    expect(printed()).toEqual({
      workflowId: WORKFLOW_ID,
      dir: root,
      server: 'checked',
      state: 'clean',
      local: [],
      drift: [],
      conflicts: [],
      plan: {
        blocksAdded: 0,
        blocksRemoved: 0,
        blocksModified: 0,
        edgesAdded: 0,
        edgesRemoved: 0,
        variablesRemoved: 0,
        errors: 0,
        warnings: 0,
      },
      next: null,
    })
    const [path, request] = mockRequest.mock.calls[0]
    expect(path).toBe(`/api/v2/workflows/${WORKFLOW_ID}/source/plan`)
    expect(request).toMatchObject({
      query: { allowDelete: true },
      body: { files: GOT, lock: LOCK, base: BASE },
    })
    expect(request.query).not.toHaveProperty('dryRun')
    expect(request.body).not.toHaveProperty('provenance')
    expect(process.exitCode ?? 0).toBe(0)
  })

  it('lists the warnings its plan counts, in the document and on stderr', async () => {
    const warning = {
      code: 'W_UNRESOLVED_REF',
      severity: 'warning',
      message: '$ref.nosuch.x names no block, so it does not resolve at run time.',
      file: 'functions/score.js',
      line: 1,
      column: 8,
      frame: '> 1 | return $ref.nosuch.x',
    }
    mockRequest.mockResolvedValue(dryRun([warning, STALE]))

    await run(root, 'status')

    const { frame: _frame, ...listed } = warning
    expect(printed()).toMatchObject({ plan: null, diagnostics: [listed] })

    contextMockState.output = 'text'
    mockProfileFrom.mockReturnValue({
      ...mockedProfile(),
      workspaceId: WORKSPACE_ID,
      output: 'text',
    })
    await run(root, 'status')

    const stderr = vi.mocked(console.error).mock.calls.flat().join('\n')
    expect(stderr).toContain('functions/score.js:1:8 warning W_UNRESOLVED_REF')
    expect(stderr).not.toContain('E_APPLY_STALE')
  })

  it('keeps the marker that its listed findings were truncated, counting it as neither', async () => {
    const warning = {
      code: 'W_UNRESOLVED_REF',
      severity: 'warning',
      message: '$ref.nosuch.x names no block, so it does not resolve at run time.',
      file: 'functions/score.js',
    }
    const truncated = {
      code: 'I_FINDINGS_TRUNCATED',
      severity: 'info',
      message: '40 more findings were left out.',
    }
    mockRequest.mockResolvedValue(dryRun([warning, truncated]))

    await run(root, 'status')

    expect(printed()).toMatchObject({
      plan: { errors: 0, warnings: 1 },
      diagnostics: [warning, truncated],
    })
  })

  it('reports an edit, a deleted function file and a new one, exit 11', async () => {
    write(
      root,
      'workflow.ts',
      ENTRY.replace('})\n})', "})\n  fn('Rank', { code: codeFile('./functions/rank.js') })\n})")
    )
    unlinkSync(join(root, 'functions/score.js'))
    write(root, 'functions/rank.js', 'return 2\n')
    mockRequest.mockResolvedValue(dryRun([], 1))

    await run(root, 'status')

    const report = printed()
    expect(report.local).toEqual([
      {
        kind: 'workflow',
        key: WORKFLOW_ID,
        change: 'edited',
        files: [
          { path: 'functions/rank.js', change: 'created' },
          { path: 'functions/score.js', change: 'deleted' },
          { path: 'workflow.ts', change: 'edited' },
        ],
      },
    ])
    expect(report.next).toMatchObject({ command: `sim workflows source apply --dir ${root} --yes` })
    expect(process.exitCode).toBe(11)
  })

  it('names --allow-delete in the apply it recommends when the edit removes a variable', async () => {
    write(root, 'workflow.ts', `${ENTRY}// edited\n`)
    const plan = dryRun([], 1)
    plan.data.diff.variables.removed = ['threshold'] as never[]
    mockRequest.mockResolvedValue(plan)

    await run(root, 'status')

    expect(printed().next).toMatchObject({
      command: `sim workflows source apply --dir ${root} --yes --allow-delete`,
    })
  })

  it('leaves out a function file no codeFile() names, which applying never sends, and says so', async () => {
    write(root, 'functions/notes.js', 'return 3\n')
    mockRequest.mockResolvedValue(dryRun())

    await run(root, 'status')

    expect(printed()).toMatchObject({
      state: 'clean',
      local: [],
      unnamed: ['functions/notes.js'],
      next: null,
    })
    expect(process.exitCode ?? 0).toBe(0)

    vi.mocked(console.log).mockClear()
    await run(root, 'diff', '--server')
    expect(printed()).toMatchObject({ files: [] })
  })

  it('does not report a recorded function file as deleted once no codeFile() names it but it is still on disk', async () => {
    write(
      root,
      'workflow.ts',
      ENTRY.replace("  fn('Score', { code: codeFile('./functions/score.js') })\n", '')
    )
    write(root, '.sim/lock.json', JSON.stringify({ ...LOCK, blocks: {} }))
    mockRequest.mockResolvedValue(dryRun([], 1))

    await run(root, 'status')

    expect(printed()).toMatchObject({
      local: [
        {
          kind: 'workflow',
          key: WORKFLOW_ID,
          change: 'edited',
          files: [{ path: 'workflow.ts', change: 'edited' }],
        },
      ],
      unnamed: ['functions/score.js'],
    })
  })

  it('reports drift when the workflow changed on the server and nothing here, exit 12', async () => {
    mockRequest.mockResolvedValue(dryRun([STALE]))

    await run(root, 'status')

    expect(printed()).toMatchObject({
      state: 'drift',
      drift: [{ kind: 'workflow', key: WORKFLOW_ID, server: 'changed' }],
      // Applying is refused as stale, so no plan of what it would change is shown.
      plan: null,
      next: { command: `sim workflows source get ${WORKFLOW_ID} --dir ${root}` },
    })
    expect(process.exitCode).toBe(12)
  })

  it('reports a conflict when both sides changed, exit 12, and names a fresh get', async () => {
    write(root, 'workflow.ts', `${ENTRY}// edited\n`)
    mockRequest.mockResolvedValue(dryRun([STALE]))

    await run(root, 'status')

    expect(printed()).toMatchObject({
      state: 'conflict',
      conflicts: [{ kind: 'workflow', key: WORKFLOW_ID, server: 'changed', change: 'edited' }],
      next: { command: `sim workflows source get ${WORKFLOW_ID} --dir <fresh dir>` },
    })
    expect(process.exitCode).toBe(12)
  })

  it('falls back to the apply dry run on a server without the plan read', async () => {
    mockRequest
      .mockRejectedValueOnce(new SimApiError('Not found', 404, 'NOT_FOUND'))
      .mockResolvedValueOnce(dryRun())

    await run(root, 'status')

    expect(mockRequest.mock.calls.map(([path]) => path)).toEqual([
      `/api/v2/workflows/${WORKFLOW_ID}/source/plan`,
      `/api/v2/workflows/${WORKFLOW_ID}/source`,
    ])
    expect(mockRequest.mock.calls[1][1].query).toEqual({ dryRun: true, allowDelete: true })
    expect(printed()).toMatchObject({ state: 'clean', server: 'checked' })
  })

  it('reports a workflow the server no longer has as deleted there', async () => {
    mockRequest.mockRejectedValue(new SimApiError('Workflow not found', 404, 'NOT_FOUND'))

    await run(root, 'status')

    expect(printed()).toMatchObject({
      state: 'drift',
      drift: [{ kind: 'workflow', key: WORKFLOW_ID, server: 'deleted' }],
    })
  })

  it('degrades to the local view when the server cannot be reached', async () => {
    write(root, 'workflow.ts', `${ENTRY}// edited\n`)
    mockRequest.mockRejectedValue(new SimApiError('Bad gateway', 502))

    await run(root, 'status')

    expect(printed()).toMatchObject({ server: 'unreachable', state: 'local', plan: null })
    expect(process.exitCode).toBe(11)
  })

  it('degrades to the local view without a login, saying why in a sentence', async () => {
    write(root, 'workflow.ts', `${ENTRY}// edited\n`)
    mockRequest.mockRejectedValue(
      new SimApiError(
        'Not logged in on profile "default". Run: sim login --profile default',
        0,
        'AUTH_REQUIRED',
        undefined,
        13
      )
    )

    await run(root, 'status')

    expect(printed()).toMatchObject({
      server: 'unreachable',
      state: 'local',
      note: 'Not logged in on profile "default". Run: sim login --profile default. Showing local changes only.',
      // A dry run would only exit 13: the login is the next step.
      next: { command: 'sim login --profile default' },
    })
    expect(process.exitCode).toBe(13)
  })

  it('exits 13 without a login even when nothing changed here, like every other command', async () => {
    mockRequest.mockRejectedValue(
      new SimApiError('Not logged in on profile "default".', 0, 'AUTH_REQUIRED', undefined, 13)
    )

    await run(root, 'status')

    expect(printed()).toMatchObject({ server: 'unreachable', state: 'clean' })
    expect(process.exitCode).toBe(13)
  })

  it('degrades to the local view when the server refuses the credential, naming the login', async () => {
    write(root, 'workflow.ts', `${ENTRY}// edited\n`)
    mockRequest.mockRejectedValue(
      new SimApiError(
        'Invalid API key — run sim login --profile default',
        401,
        'UNAUTHORIZED',
        undefined,
        13
      )
    )

    await run(root, 'status')

    expect(printed()).toMatchObject({
      server: 'unreachable',
      state: 'local',
      next: { command: 'sim login --profile default' },
    })
    expect(process.exitCode).toBe(13)
  })

  it('fails on a cancelled request instead of reporting the server unreachable', async () => {
    write(root, 'workflow.ts', `${ENTRY}// edited\n`)
    mockRequest.mockRejectedValue(new SimApiError('Request cancelled.', 0, REQUEST_CANCELLED))

    await expect(run(root, 'status')).rejects.toMatchObject({ code: REQUEST_CANCELLED })
    expect(process.exitCode).toBeUndefined()
  })

  it('fails on a refusal of its own directory instead of reporting the server unreachable', async () => {
    write(root, 'workflow.ts', `${ENTRY}// edited\n`)
    mkdirSync(join(root, '.sim/sdk/workspace.d.ts'), { recursive: true })
    write(root, '.sim/sdk/workspace.manifest.json', '{}\n')
    mockRequest.mockResolvedValue(dryRun())

    await expect(run(root, 'status')).rejects.toMatchObject({ name: 'SourceDirError' })
    expect(process.exitCode).toBeUndefined()
  })

  it('exits 7 when the server refuses the workflow as too large, as a get does', async () => {
    mockRequest.mockRejectedValue(new SimApiError('Too large', 413, 'PAYLOAD_TOO_LARGE'))

    await expect(run(root, 'status')).rejects.toMatchObject({ exitCode: 7 })
    await expect(run(root, 'diff', '--server')).rejects.toMatchObject({ exitCode: 7 })
  })

  it("reads a workspace folder's changes from the workspace directory's record", async () => {
    const folder = join(root, 'ws/workflows/score')
    write(
      join(root, 'ws'),
      '.sim/base.json',
      JSON.stringify({ version: 1, workspaceId: WORKSPACE_ID, resources: {} })
    )
    writeWorkflowDir(folder, { at: join(root, 'ws'), prefix: 'workflows/score/' })
    write(folder, 'functions/score.js', 'return 3\n')

    await run(folder, 'status', '--offline')

    expect(printed()).toMatchObject({
      server: 'offline',
      local: [{ files: [{ path: 'functions/score.js', change: 'edited' }] }],
    })
  })
  it.each([
    [
      'the workspace record, which records the folder base on disk, over a stale record of its own',
      true,
      [],
    ],
    [
      'a record of its own when the workspace record predates the folder base (an older CLI wrote it)',
      false,
      [{ path: 'functions/score.js', change: 'edited' }],
    ],
  ])('in a workspace folder, reads %s', async (_label, rootCurrent, files) => {
    const ws = join(root, 'ws')
    const folder = join(ws, 'workflows/score')
    write(
      ws,
      '.sim/base.json',
      JSON.stringify({ version: 1, workspaceId: WORKSPACE_ID, resources: {} })
    )
    writeWorkflowDir(folder, { at: ws, prefix: 'workflows/score/' })
    const rootRecord = JSON.parse(readFileSync(join(ws, '.sim/written.json'), 'utf8'))
    rootRecord.files['workflows/score/.sim/base.json'] = rootCurrent
      ? digest(JSON.stringify(BASE))
      : digest('an older base')
    write(ws, '.sim/written.json', JSON.stringify(rootRecord))
    // A nested record an older CLI left: score.js as it was before the last write.
    write(
      folder,
      '.sim/written.json',
      JSON.stringify({
        version: 1,
        files: { 'workflow.ts': digest(ENTRY), 'functions/score.js': digest('return 0\n') },
      })
    )

    await run(folder, 'status', '--offline')

    expect(printed()).toMatchObject({ server: 'offline' })
    const local = (printed().local ?? []) as Array<{ files: unknown[] }>
    expect(local.flatMap((entry) => entry.files)).toEqual(files)
  })
})

describe('workflows source diff', () => {
  it('shows an edit against the base text, and with --server against the server now', async () => {
    write(root, 'functions/score.js', 'return 2\n')
    mockRequest.mockResolvedValue({ data: { ...dryRun().data, files: GOT } })

    await run(root, 'diff')

    expect(mockRequest.mock.calls[0][0]).toBe(`/api/v2/workflows/${WORKFLOW_ID}/source`)
    expect(printed()).toEqual({
      dir: root,
      against: 'base',
      files: [
        {
          path: 'functions/score.js',
          change: 'edited',
          patch:
            '--- base/functions/score.js\n+++ local/functions/score.js\n@@ -1,1 +1,1 @@\n-return 1\n+return 2\n',
        },
      ],
    })

    mockRequest.mockResolvedValue({
      data: { ...dryRun().data, files: { ...GOT, 'workflow.ts': `${ENTRY}// theirs\n` } },
    })
    await run(root, 'diff', '--server', 'workflow.ts')

    expect(printed()).toMatchObject({
      against: 'server',
      files: [{ path: 'workflow.ts', change: 'edited' }],
    })
  })

  it('selects files by ./, an absolute path or a path from the current directory', async () => {
    write(root, 'functions/score.js', 'return 2\n')
    mockRequest.mockResolvedValue({ data: { ...dryRun().data, files: GOT } })
    const cwd = process.cwd()
    try {
      process.chdir(dirname(root))
      for (const filter of [
        './',
        join(root, 'functions'),
        join(basename(root), 'functions/score.js'),
      ]) {
        await run(root, 'diff', filter)
        expect(printed()).toMatchObject({ files: [{ path: 'functions/score.js' }] })
      }
    } finally {
      process.chdir(cwd)
    }
  })

  it('refuses a filter that selects no file instead of printing no changes', async () => {
    write(root, 'functions/score.js', 'return 2\n')
    mockRequest.mockResolvedValue({ data: { ...dryRun().data, files: GOT } })

    await expect(run(root, 'diff', 'functions/scroe.js')).rejects.toMatchObject({
      code: 'SOURCE_PATH_UNMATCHED',
      message: expect.stringContaining('"functions/scroe.js" selects no file'),
    })
    await expect(run(root, 'diff', '/')).rejects.toMatchObject({ code: 'SOURCE_PATH_UNMATCHED' })
  })

  it('prints a colorless unified diff for a person when stdout is not a terminal', async () => {
    write(root, 'functions/score.js', 'return 2\n')
    mockRequest.mockResolvedValue({ data: { ...dryRun().data, files: GOT } })
    mockProfileFrom.mockReturnValue({
      ...mockedProfile(),
      workspaceId: WORKSPACE_ID,
      output: 'text',
    })

    await run(root, 'diff')

    expect(String(vi.mocked(console.log).mock.calls.at(-1)?.[0])).toBe(
      '--- base/functions/score.js\n+++ local/functions/score.js\n@@ -1,1 +1,1 @@\n-return 1\n+return 2'
    )
  })
})
