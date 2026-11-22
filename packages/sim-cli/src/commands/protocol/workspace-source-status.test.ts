import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SimApiError } from '../../http/client'
import { contextMockFns, contextMockState, mockedProfile } from '../../test/context-mock'
import { digest } from './source-dir'
import { attachWorkspaceSourceDiff, attachWorkspaceSourceStatus } from './workspace-source-status'

vi.mock('../../context', async () => (await import('../../test/context-mock')).contextMock)

const { mockRequest, mockProfileFrom } = contextMockFns

const WORKSPACE_ID = 'ws_local'
const BASE = { version: 1, workspaceId: WORKSPACE_ID, resources: {} }
const LEADS = "// @sim-sdk 1\nexport default defineTable({ name: 'leads', columns: {} })\n"
const DEALS = "// @sim-sdk 1\nexport default defineTable({ name: 'deals', columns: {} })\n"
const INGEST = "// @sim-sdk 1\nexport default workflow('Ingest', {}, () => {})\n"
const INGEST_BASE = `${JSON.stringify({ workflowId: 'wf_1', workspaceId: WORKSPACE_ID, fingerprint: 'sf1:a', catalogHash: 'c' })}\n`
const NOTES = Buffer.from('binary notes, version one')

/** The files a get wrote, by path: what `.sim/written.json` records. */
const GOT: Record<string, string> = {
  'tables/leads.ts': LEADS,
  'tables/deals.ts': DEALS,
  'workflows/ingest/workflow.ts': INGEST,
  'workflows/ingest/.sim/base.json': INGEST_BASE,
}

let dir: string

function write(path: string, text: string | Buffer) {
  mkdirSync(dirname(join(dir, path)), { recursive: true })
  writeFileSync(join(dir, path), text)
}

async function run(command: 'status' | 'diff', ...argv: string[]): Promise<void> {
  const source = new Command('source')
  attachWorkspaceSourceStatus(source)
  attachWorkspaceSourceDiff(source)
  source.exitOverride()
  for (const each of source.commands) each.exitOverride()
  await source.parseAsync(['node', 'source', command, '--dir', dir, ...argv])
}

/** The JSON the last command printed. */
function printed(): Record<string, unknown> {
  return JSON.parse(vi.mocked(console.log).mock.calls.at(-1)?.join(' ') ?? '{}')
}

/** A dry run's answer: the plan's changes and findings. */
function dryRun(
  plan: Array<Record<string, unknown>> = [],
  diagnostics: Array<Record<string, unknown>> = []
) {
  return {
    data: {
      workspaceId: WORKSPACE_ID,
      dryRun: true,
      plan,
      applied: [],
      needBlobs: [],
      files: {},
      base: BASE,
      diagnostics,
    },
  }
}

/** A get's answer for `kinds`: the server's current files and blobs. */
function served(files: Record<string, string>, blobs: Array<Record<string, unknown>> = []) {
  return {
    data: {
      workspaceId: WORKSPACE_ID,
      kinds: ['table', 'file', 'workflow'],
      files,
      blobs,
      base: BASE,
      skipped: [],
      diagnostics: [],
    },
  }
}

/** The bodies of the dry runs sent. */
function sentFiles(): Array<Record<string, string>> {
  return mockRequest.mock.calls.map((call) => call[1].body.files)
}

beforeEach(() => {
  contextMockState.output = 'json'
  contextMockState.workspaceSource = 'config'
  contextMockState.workspaceId = WORKSPACE_ID
  mockRequest.mockReset()
  mockProfileFrom.mockReturnValue({ ...mockedProfile(), workspaceId: WORKSPACE_ID, output: 'json' })
  dir = mkdtempSync(join(tmpdir(), 'sim-workspace-status-'))
  write('.sim/base.json', JSON.stringify(BASE))
  for (const [path, text] of Object.entries(GOT)) write(path, text)
  write(
    '.sim/written.json',
    JSON.stringify({
      version: 1,
      files: Object.fromEntries(Object.entries(GOT).map(([path, text]) => [path, digest(text)])),
    })
  )
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  process.exitCode = undefined
  rmSync(dir, { recursive: true, force: true })
})

describe('workspaces source status', () => {
  it('is clean, exit 0, when nothing changed on either side', async () => {
    mockRequest.mockResolvedValue(dryRun())

    await run('status')

    expect(printed()).toEqual({
      workspaceId: WORKSPACE_ID,
      dir,
      server: 'checked',
      state: 'clean',
      local: [],
      drift: [],
      conflicts: [],
      plan: {
        create: 0,
        update: 0,
        delete: 0,
        unchanged: 0,
        held: 0,
        conflicts: 0,
        errors: 0,
        warnings: 0,
      },
      next: null,
    })
    expect(process.exitCode ?? 0).toBe(0)
  })

  it('lists the warnings its plan counts', async () => {
    const warning = {
      code: 'W_UNRESOLVED_REF',
      severity: 'warning',
      message: '$ref.nosuch.x names no block, so it does not resolve at run time.',
      file: 'workflows/ingest/functions/f.js',
      line: 1,
      column: 8,
      kind: 'workflow',
      key: 'ingest',
    }
    write('workflows/ingest/workflow.ts', INGEST.replace("'Ingest'", "'Ingest v2'"))
    mockRequest.mockResolvedValue(dryRun([], [warning]))

    await run('status')

    expect(printed()).toMatchObject({ plan: { warnings: 1 }, diagnostics: [warning] })
    expect(vi.mocked(console.error)).not.toHaveBeenCalled()

    vi.stubEnv('GITHUB_ACTIONS', 'true')
    await run('status')

    expect(vi.mocked(console.error).mock.calls.map((call) => call.join(' '))).toEqual([
      `::warning file=${join(dir, warning.file)},line=1,col=8,title=W_UNRESOLVED_REF::${warning.message}`,
    ])
  })

  it('waits for no writer: a status while another command holds the directory exits 10, reading nothing', async () => {
    write('.sim/command.lock/owner.json', JSON.stringify({ pid: process.pid, host: hostname() }))
    mockRequest.mockResolvedValue(dryRun())

    const busy = await run('status').then(
      () => null,
      (error: unknown) => error
    )
    const diffed = await run('diff').then(
      () => null,
      (error: unknown) => error
    )

    expect(busy).toMatchObject({ code: 'SOURCE_DIR_BUSY', exitCode: 10 })
    expect(diffed).toMatchObject({ code: 'SOURCE_DIR_BUSY', exitCode: 10 })
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it('refuses a directory holding no workspace source, as an apply does, instead of calling it clean', async () => {
    mockRequest.mockResolvedValue(dryRun())
    const workspace = dir
    const refusal = async (command: 'status' | 'diff') =>
      run(command).then(
        () => null,
        (error: unknown) => error
      )

    dir = mkdtempSync(join(tmpdir(), 'sim-workspace-status-empty-'))
    try {
      expect(await refusal('status')).toMatchObject({
        message: expect.stringContaining('holds no workspace source'),
      })
      expect(await refusal('diff')).toMatchObject({
        message: expect.stringContaining('holds no workspace source'),
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
    dir = join(workspace, 'workflows/ingest')
    expect(await refusal('status')).toMatchObject({
      message: expect.stringContaining('is a workflow source directory'),
    })
    dir = workspace
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it('reads a directory no one may write without its lock, rather than crashing on it', async () => {
    write('tables/leads.ts', `${LEADS}// edited\n`)
    mockRequest.mockResolvedValue(dryRun([{ kind: 'table', key: 'leads', action: 'update' }]))
    const folders = ['', '.sim', 'tables', 'workflows', 'workflows/ingest']
    for (const path of folders) chmodSync(join(dir, path), 0o555)
    try {
      await run('status')
      expect(printed()).toMatchObject({ state: 'local', local: [{ kind: 'table', key: 'leads' }] })
      await run('diff')
      expect(printed()).toMatchObject({ files: [{ path: 'tables/leads.ts', change: 'edited' }] })
    } finally {
      for (const path of folders) chmodSync(join(dir, path), 0o755)
    }
  })

  it('refuses a written record a merge conflict broke, naming the get, rather than calling every file created', async () => {
    write('.sim/written.json', '<<<<<<< HEAD\n{"version":1,"files":{}}\n=======\n')
    mockRequest.mockResolvedValue(dryRun())

    const refused = await run('status').then(
      () => null,
      (error: unknown) => error
    )

    expect(refused).toMatchObject({
      code: 'SOURCE_WRITTEN_INVALID',
      message: expect.stringContaining(`sim workspaces source get --dir ${dir}`),
    })
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it('reports an edit, a delete and a new file by resource, exit 11, and names the apply', async () => {
    write('tables/leads.ts', `${LEADS}// edited\n`)
    unlinkSync(join(dir, 'tables/deals.ts'))
    write('skills/tone.md', '# Tone\n')
    mockRequest.mockResolvedValue(
      dryRun([
        { kind: 'table', key: 'leads', action: 'update' },
        { kind: 'table', key: 'deals', action: 'delete' },
        { kind: 'skill', key: 'tone', action: 'create' },
      ])
    )

    await run('status')

    const report = printed()
    expect(report.state).toBe('local')
    expect(report.local).toEqual([
      {
        kind: 'skill',
        key: 'tone',
        change: 'created',
        files: [{ path: 'skills/tone.md', change: 'created' }],
      },
      {
        kind: 'table',
        key: 'deals',
        change: 'deleted',
        files: [{ path: 'tables/deals.ts', change: 'deleted' }],
      },
      {
        kind: 'table',
        key: 'leads',
        change: 'edited',
        files: [{ path: 'tables/leads.ts', change: 'edited' }],
      },
    ])
    expect(report.next).toEqual({
      command: `sim workspaces source apply --dir ${dir} --yes --allow-delete`,
      reason: 'Applies your changes.',
    })
    expect(process.exitCode).toBe(11)
  })

  it('recommends commands scoped to the kinds the status was', async () => {
    write('tables/leads.ts', LEADS.replace('columns: {}', 'columns: { email: column.string() }'))
    mockRequest.mockResolvedValue(dryRun([{ kind: 'table', key: 'leads', action: 'update' }]))

    await run('status', '--only', 'tables')

    expect(printed().next).toEqual({
      command: `sim workspaces source apply --dir ${dir} --yes --only tables`,
      reason: 'Applies your changes.',
    })

    mockRequest.mockResolvedValue(
      dryRun(
        [{ kind: 'table', key: 'leads', action: 'update' }],
        [{ code: 'E_DECL_INVALID', severity: 'error', message: 'bad', kind: 'table', key: 'leads' }]
      )
    )
    await run('status', '--only', 'tables,workflow')
    expect(printed().next).toMatchObject({
      command: `sim workspaces source apply --dir ${dir} --dry-run --only tables,workflows`,
    })
  })

  it('compares with the workspace the directory was read from, whatever the profile default', async () => {
    contextMockState.workspaceId = 'ws_other'
    write('tables/leads.ts', LEADS.replace('columns: {}', 'columns: { email: column.string() }'))
    mockRequest.mockResolvedValue(dryRun([{ kind: 'table', key: 'leads', action: 'update' }]))

    await run('status')

    expect(mockRequest.mock.calls[0][0]).toBe(`/api/v2/workspaces/${WORKSPACE_ID}/source/plan`)
    expect(printed().next).toMatchObject({
      command: `sim workspaces source apply --dir ${dir} --yes`,
    })
  })

  it('refuses a --workspace naming another workspace than the directory was read from', async () => {
    contextMockState.workspaceSource = 'flag'
    contextMockState.workspaceId = 'ws_other'

    await expect(run('status')).rejects.toMatchObject({ code: 'SOURCE_OTHER_WORKSPACE' })
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it('recommends --allow-delete for an update that drops data, as applying it needs', async () => {
    write('tables/leads.ts', LEADS.replace("name: 'leads'", "name: 'leads', description: 'x'"))
    mockRequest.mockResolvedValue(
      dryRun([
        {
          kind: 'table',
          key: 'leads',
          action: 'update',
          fields: ['columns.email'],
          destructive: { what: 'column email', counts: { values: 3 } },
        },
      ])
    )

    await run('status')

    expect(printed().next).toEqual({
      command: `sim workspaces source apply --dir ${dir} --yes --allow-delete`,
      reason: 'Applies your changes.',
    })
  })

  it('reports the files of a removed kind folder as deleted, as a get refuses to write them again', async () => {
    rmSync(join(dir, 'tables'), { recursive: true })
    mockRequest.mockResolvedValue(dryRun())

    await run('status')

    expect(printed()).toMatchObject({
      state: 'local',
      local: [
        { kind: 'table', key: 'deals', change: 'deleted' },
        { kind: 'table', key: 'leads', change: 'deleted' },
      ],
      // An apply leaves an unmanaged kind alone, so recommending it would loop forever.
      next: {
        command: `sim workspaces source get --dir ${dir} --only tables --force`,
        reason: expect.stringContaining('an apply leaves their resources alone'),
      },
    })

    await run('status', '--only', 'workflows')
    expect(printed()).toMatchObject({ state: 'clean', local: [] })

    write('workflows/ingest/workflow.ts', `${INGEST}// edited\n`)
    await run('status')
    expect(printed()).toMatchObject({
      next: { command: `sim workspaces source apply --dir ${dir} --yes` },
    })
  })

  it('reports a binary file the CLI wrote that is missing now as deleted', async () => {
    write(
      '.sim/written.json',
      JSON.stringify({
        version: 1,
        files: {
          ...Object.fromEntries(Object.entries(GOT).map(([path, text]) => [path, digest(text)])),
          'files/notes.bin': createHash('sha256').update(NOTES).digest('hex'),
        },
      })
    )
    mkdirSync(join(dir, 'files'), { recursive: true })
    write('files/.gitkeep', '')
    mockRequest.mockResolvedValue(dryRun())

    await run('status')

    expect(printed()).toMatchObject({
      state: 'local',
      local: [{ kind: 'file', key: 'notes.bin', change: 'deleted' }],
    })
  })

  it('leaves out a function file no codeFile() names, as an apply never sends it: clean, exit 0, naming it', async () => {
    write('workflows/ingest/functions/scratch.js', 'return 1\n')
    mockRequest.mockResolvedValue(dryRun())

    await run('status')

    expect(printed()).toMatchObject({
      state: 'clean',
      local: [],
      unnamed: ['workflows/ingest/functions/scratch.js'],
    })
    expect(sentFiles()[0]['workflows/ingest/functions/scratch.js']).toBeUndefined()
    expect(process.exitCode ?? 0).toBe(0)
  })

  it('does not report a recorded function file as deleted once no codeFile() names it but it is still on disk', async () => {
    write(
      '.sim/written.json',
      JSON.stringify({
        version: 1,
        files: {
          ...Object.fromEntries(Object.entries(GOT).map(([path, text]) => [path, digest(text)])),
          'workflows/ingest/functions/scratch.js': digest('return 1\n'),
        },
      })
    )
    write('workflows/ingest/functions/scratch.js', 'return 1\n')
    mockRequest.mockResolvedValue(dryRun())

    await run('status')

    expect(printed()).toMatchObject({
      state: 'clean',
      local: [],
      unnamed: ['workflows/ingest/functions/scratch.js'],
    })
    expect(process.exitCode ?? 0).toBe(0)
  })

  it('still counts a new function file the lock names as a local change', async () => {
    write(
      'workflows/ingest/.sim/lock.json',
      JSON.stringify({ version: 1, blocks: { run: { id: 'b1', codeFile: 'functions/run.js' } } })
    )
    write('workflows/ingest/functions/run.js', 'return 1\n')
    mockRequest.mockResolvedValue(dryRun())

    await run('status')

    expect(printed()).not.toHaveProperty('unnamed')
    expect(sentFiles()[0]['workflows/ingest/functions/run.js']).toBe('return 1\n')
    expect(process.exitCode).toBe(11)
  })

  it('sends every workflow folder whole to the plan read, so it compares each with the stored workflow', async () => {
    mockRequest.mockResolvedValue(dryRun())

    await run('status')

    expect(sentFiles()[0]['workflows/ingest/workflow.ts']).toBe(INGEST)
    expect(mockRequest.mock.calls[0][0]).toBe('/api/v2/workspaces/ws_local/source/plan')
    expect(mockRequest.mock.calls[0][1]).toMatchObject({ body: { options: { allowDelete: true } } })
    expect(mockRequest.mock.calls[0][1].query).toBeUndefined()
  })

  it('past one dry run, sends an unchanged workflow folder by its base and an edited one whole', async () => {
    const files: Record<string, string> = { ...GOT }
    for (let index = 0; index < 100; index++) {
      const folder = `workflows/w${index}`
      files[`${folder}/workflow.ts`] = INGEST
      files[`${folder}/.sim/base.json`] = INGEST_BASE
    }
    for (const [path, text] of Object.entries(files)) write(path, text)
    write(
      '.sim/written.json',
      JSON.stringify({
        version: 1,
        files: Object.fromEntries(
          Object.entries(files).map(([path, text]) => [path, digest(text)])
        ),
      })
    )
    write('workflows/w7/workflow.ts', `${INGEST}// edited\n`)
    mockRequest.mockResolvedValue(dryRun())

    await run('status')

    const sent = sentFiles()[0]
    expect(sent['workflows/w7/workflow.ts']).toBe(`${INGEST}// edited\n`)
    expect(sent['workflows/w8/workflow.ts']).toBeUndefined()
    expect(sent['workflows/w8/.sim/base.json']).toBe(INGEST_BASE)
    expect(printed().note).toContain('More workflow folders than one dry run compares')
  })

  it('reports drift when the server changed a resource left alone here, exit 12, and names a get', async () => {
    mockRequest.mockResolvedValue(
      dryRun(
        [{ kind: 'workflow', key: 'ingest', action: 'noop' }],
        [
          {
            code: 'W_SERVER_CHANGED',
            severity: 'warning',
            message: 'm',
            kind: 'table',
            key: 'leads',
          },
          {
            code: 'E_APPLY_STALE',
            severity: 'error',
            message: 'm',
            kind: 'workflow',
            key: 'ingest',
          },
          { code: 'W_UNDECLARED', severity: 'warning', message: 'm', kind: 'skill', key: 'new' },
        ]
      )
    )

    await run('status')

    const report = printed()
    expect(report.state).toBe('drift')
    expect(report.drift).toEqual([
      { kind: 'skill', key: 'new', server: 'added' },
      { kind: 'table', key: 'leads', server: 'changed' },
      { kind: 'workflow', key: 'ingest', server: 'changed' },
    ])
    // As its dry run counts them: the server changes left alone warn, and the stale workflow is
    // one an apply sends by its base, so it refuses nothing.
    expect(report.plan).toMatchObject({ errors: 0, warnings: 2 })
    expect(report.next).toMatchObject({ command: `sim workspaces source get --dir ${dir}` })
    expect(process.exitCode).toBe(12)
  })

  it('counts a drifted workflow left alone here as unchanged, as an apply sends it by its base', async () => {
    mockRequest.mockResolvedValue(
      dryRun(
        [{ kind: 'workflow', key: 'ingest', action: 'update' }],
        [
          {
            code: 'E_APPLY_STALE',
            severity: 'error',
            message: 'm',
            kind: 'workflow',
            key: 'ingest',
          },
        ]
      )
    )

    await run('status')

    expect(printed().plan).toMatchObject({ update: 0, unchanged: 1 })
  })

  it('leaves out lint findings on a workflow an apply sends by its base, as its dry run does', async () => {
    mockRequest.mockResolvedValue(
      dryRun(
        [{ kind: 'workflow', key: 'ingest', action: 'noop' }],
        [
          {
            code: 'W_APPLY_LINT',
            severity: 'warning',
            message: 'Start must be connected',
            kind: 'workflow',
            key: 'ingest',
          },
        ]
      )
    )

    await run('status')

    const report = printed()
    expect(report.plan).toMatchObject({ errors: 0, warnings: 0 })
    expect(report.diagnostics ?? []).toEqual([])
  })

  it('keeps a plan refusal about a workflow an apply sends by its base: status counts the error the apply refuses with', async () => {
    mockRequest.mockResolvedValue(
      dryRun(
        [
          { kind: 'workflow', key: 'ingest', action: 'noop' },
          { kind: 'table', key: 'leads', action: 'delete' },
        ],
        [
          {
            code: 'E_PLAN_REF_DELETED',
            severity: 'error',
            message: 'workflows/ingest/ uses table "leads", which this apply deletes.',
            kind: 'workflow',
            key: 'ingest',
          },
        ]
      )
    )

    await run('status')

    const report = printed()
    expect(report.plan).toMatchObject({ delete: 1, errors: 1 })
    expect(report.diagnostics).toEqual([expect.objectContaining({ code: 'E_PLAN_REF_DELETED' })])
  })

  it('keeps lint findings on a workflow edited here, which an apply sends whole', async () => {
    write('workflows/ingest/workflow.ts', INGEST.replace("'Ingest'", "'Ingest v2'"))
    mockRequest.mockResolvedValue(
      dryRun(
        [{ kind: 'workflow', key: 'ingest', action: 'update' }],
        [
          {
            code: 'W_APPLY_LINT',
            severity: 'warning',
            message: 'Start must be connected',
            kind: 'workflow',
            key: 'ingest',
          },
        ]
      )
    )

    await run('status')

    expect(printed().plan).toMatchObject({ warnings: 1 })
  })

  it('counts an edited workflow as the update its dry run plans', async () => {
    write('workflows/ingest/workflow.ts', INGEST.replace("'Ingest'", "'Ingest v2'"))
    mockRequest.mockResolvedValue(dryRun([{ kind: 'workflow', key: 'ingest', action: 'update' }]))

    await run('status')

    expect(printed().plan).toMatchObject({ update: 1, unchanged: 0 })
  })

  it('never reports a resource the get skipped as added on the server', async () => {
    write('.sim/skipped.json', JSON.stringify([{ kind: 'file', key: 'big.bin', reason: 'size' }]))
    mockRequest.mockResolvedValue(
      dryRun(
        [],
        [{ code: 'W_UNDECLARED', severity: 'warning', message: 'm', kind: 'file', key: 'big.bin' }]
      )
    )

    await run('status')

    expect(printed()).toMatchObject({ state: 'clean', drift: [] })
  })

  it('reports a conflict when a locally edited resource changed on the server, exit 12', async () => {
    write('tables/leads.ts', `${LEADS}// edited\n`)
    mockRequest.mockResolvedValue(
      dryRun(
        [{ kind: 'table', key: 'leads', action: 'noop' }],
        [{ code: 'E_APPLY_STALE', severity: 'error', message: 'm', kind: 'table', key: 'leads' }]
      )
    )

    await run('status')

    const report = printed()
    expect(report.state).toBe('conflict')
    expect(report.conflicts).toEqual([
      { kind: 'table', key: 'leads', server: 'changed', change: 'edited' },
    ])
    expect(report.drift).toEqual([])
    expect(report.next).toMatchObject({
      command: 'sim workspaces source get --dir <fresh dir>',
    })
    expect(report.plan).toMatchObject({ conflicts: 1, errors: 1 })
    expect(process.exitCode).toBe(12)
  })

  it('says a conflict refuses the apply, never "0 error(s)" alone, for a person', async () => {
    write('tables/leads.ts', `${LEADS}// edited\n`)
    mockRequest.mockResolvedValue(
      dryRun(
        [{ kind: 'table', key: 'leads', action: 'noop' }],
        [{ code: 'E_APPLY_STALE', severity: 'error', message: 'm', kind: 'table', key: 'leads' }]
      )
    )
    mockProfileFrom.mockReturnValue({
      ...mockedProfile(),
      workspaceId: WORKSPACE_ID,
      output: 'text',
    })

    await run('status')

    const screen = String(vi.mocked(console.log).mock.calls.at(-1)?.[0])
    expect(screen).toContain(
      'Applying would be refused as stale (exit 5): the 1 conflict(s) above. Its dry run: 0 create, 0 update, 0 delete (1 unchanged); 1 error(s), 0 warning(s).'
    )
  })

  it('degrades to the local view when the server cannot be reached, and says so', async () => {
    write('tables/leads.ts', `${LEADS}// edited\n`)
    mockRequest.mockRejectedValue(
      new SimApiError('Could not reach https://sim.example: ECONNREFUSED', 0)
    )

    await run('status')

    const report = printed()
    expect(report).toMatchObject({
      server: 'unreachable',
      state: 'local',
      plan: null,
      next: { command: `sim workspaces source apply --dir ${dir} --dry-run` },
    })
    expect(report.note).toContain('Could not reach')
    expect(process.exitCode).toBe(11)
  })

  it('recommends the login, not a dry run that would exit 13, when the profile has none', async () => {
    rmSync(join(dir, 'tables'), { recursive: true })
    mockRequest.mockRejectedValue(
      new SimApiError(
        'Not logged in on profile "default". Run: sim login --profile default',
        0,
        'AUTH_REQUIRED',
        undefined,
        13
      )
    )

    await run('status')

    expect(printed()).toMatchObject({
      server: 'unreachable',
      next: { command: 'sim login --profile default' },
    })
    expect(process.exitCode).toBe(13)
  })

  it('fails rather than hides a server refusal that is not about reaching it', async () => {
    mockRequest.mockRejectedValue(new SimApiError('Forbidden', 403, 'FORBIDDEN'))

    await expect(run('status')).rejects.toThrow('Forbidden')
  })

  it('asks no server with --offline', async () => {
    await run('status', '--offline')

    expect(mockRequest).not.toHaveBeenCalled()
    expect(printed()).toMatchObject({ server: 'offline', state: 'clean', next: null })
    expect(process.exitCode ?? 0).toBe(0)
  })

  it('prints one screen ending with the next command for a person', async () => {
    write('tables/leads.ts', `${LEADS}// edited\n`)
    mockRequest.mockResolvedValue(dryRun([{ kind: 'table', key: 'leads', action: 'update' }]))
    mockProfileFrom.mockReturnValue({
      ...mockedProfile(),
      workspaceId: WORKSPACE_ID,
      output: 'text',
    })

    await run('status')

    const screen = String(vi.mocked(console.log).mock.calls.at(-1)?.[0])
    expect(screen).toContain('edited   table leads: tables/leads.ts')
    expect(screen.trimEnd().split('\n').at(-2)).toBe(
      `Next: sim workspaces source apply --dir ${dir} --yes`
    )
  })
})

describe('workspaces source diff', () => {
  it('shows a local edit against the base text the server still holds', async () => {
    write('tables/leads.ts', LEADS.replace("'leads'", "'leads2'"))
    mockRequest.mockResolvedValue(served({ 'tables/leads.ts': LEADS }))

    await run('diff')

    const report = printed()
    expect(mockRequest.mock.calls[0][1]).toMatchObject({ query: { kinds: 'table' } })
    expect(report).toMatchObject({
      against: 'base',
      files: [{ path: 'tables/leads.ts', change: 'edited' }],
    })
    const [file] = report.files as Array<{ patch: string }>
    expect(file.patch).toContain(
      " // @sim-sdk 1\n-export default defineTable({ name: 'leads', columns: {} })"
    )
    expect(file.patch).toContain("+export default defineTable({ name: 'leads2', columns: {} })")
    expect(file.patch.startsWith('--- base/tables/leads.ts\n+++ local/tables/leads.ts\n')).toBe(
      true
    )
  })

  it('says the base text is gone when the server changed the file since', async () => {
    write('tables/leads.ts', `${LEADS}// edited\n`)
    mockRequest.mockResolvedValue(served({ 'tables/leads.ts': `${LEADS}// theirs\n` }))

    await run('diff')

    expect(printed().files).toEqual([
      {
        path: 'tables/leads.ts',
        change: 'edited',
        unavailable:
          'the server changed it since the directory was read, so its base text is gone; compare with --server',
      },
    ])
  })

  it('shows a created file without asking the server, and filters by path and by kind:key', async () => {
    write('skills/tone.md', '# Tone\n')
    write('tables/leads.ts', `${LEADS}// edited\n`)

    await run('diff', 'skill:tone')

    expect(mockRequest).not.toHaveBeenCalled()
    expect(printed().files).toEqual([
      {
        path: 'skills/tone.md',
        change: 'created',
        patch: '--- /dev/null\n+++ local/skills/tone.md\n@@ -0,0 +1,1 @@\n+# Tone\n',
      },
    ])

    await run('diff', 'skills/')
    expect((printed().files as unknown[]).length).toBe(1)
  })

  it('asks the server for the kind of a filter written with repeated ./ alone', async () => {
    write('tables/leads.ts', `${LEADS}// edited\n`)
    mockRequest.mockResolvedValue(served({ 'tables/leads.ts': LEADS }))

    await run('diff', '--server', './././tables/leads.ts')

    expect(mockRequest.mock.calls[0][1]).toMatchObject({ query: { kinds: 'table' } })
  })

  it('reports a binary file by its sizes', async () => {
    const sha256 = createHash('sha256').update(NOTES).digest('hex')
    write('files/notes.bin', Buffer.concat([NOTES, Buffer.from(' and two')]))
    const written = {
      version: 1,
      files: {
        ...Object.fromEntries(Object.entries(GOT).map(([path, text]) => [path, digest(text)])),
        'files/notes.bin': sha256,
      },
    }
    write('.sim/written.json', JSON.stringify(written))
    mockRequest.mockResolvedValue(
      served({}, [{ path: 'files/notes.bin', sha256, size: NOTES.length, id: 'f', href: '/f' }])
    )

    await run('diff')

    expect(printed().files).toEqual([
      {
        path: 'files/notes.bin',
        change: 'edited',
        binary: { before: NOTES.length, after: NOTES.length + 8 },
      },
    ])
  })

  it('with --server, compares every selected file with the server now, sidecars left out', async () => {
    mockRequest.mockResolvedValue(
      served({
        'tables/leads.ts': `${LEADS}// theirs\n`,
        'tables/deals.ts': DEALS,
        'workflows/ingest/workflow.ts': INGEST,
        'workflows/ingest/.sim/base.json': '{}\n',
      })
    )

    await run('diff', '--server')

    expect(printed()).toMatchObject({
      against: 'server',
      files: [{ path: 'tables/leads.ts', change: 'edited' }],
    })
  })

  it('names the unreachable server, still showing what needs none', async () => {
    write('tables/leads.ts', `${LEADS}// edited\n`)
    write('skills/tone.md', '# Tone\n')
    mockRequest.mockRejectedValue(
      new SimApiError('Could not reach https://sim.example: ECONNREFUSED', 0)
    )

    await run('diff')

    const report = printed()
    expect(report.unreachable).toContain('Could not reach')
    expect(report.files).toMatchObject([
      { path: 'skills/tone.md', change: 'created' },
      {
        path: 'tables/leads.ts',
        unavailable: 'its base text is read from the server, which could not be reached',
      },
    ])
  })
})
