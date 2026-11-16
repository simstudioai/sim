import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SimApiError } from '../../http/client'
import { buildGeneratedCommands } from '../../runtime/build'
import { attachProtocolCommands } from './index'

vi.mock('../../context', async () => {
  const { SimClient } = await import('../../http/client')
  const profile = {
    name: 'default',
    endpoint: 'https://sim.example',
    authProfile: 'default',
    apiKey: 'key',
    oauth: null,
    workspaceId: '00000000-0000-4000-8000-00000000000b',
    output: 'json' as const,
    sources: {
      endpoint: 'default' as const,
      credential: 'env' as const,
      workspaceId: 'env' as const,
      output: 'default' as const,
    },
  }
  return {
    globalsOf: () => ({}),
    profileFrom: () => profile,
    clientFrom: () => ({ client: new SimClient(profile), profile }),
  }
})

const WORKFLOW_ID = '00000000-0000-4000-8000-00000000000a'
const WORKSPACE_ID = '00000000-0000-4000-8000-00000000000b'
const NEW_WORKFLOW_ID = '00000000-0000-4000-8000-00000000000c'
const FIRST = `sf1:${'1'.repeat(64)}`
const SECOND = `sf1:${'2'.repeat(64)}`

/** A real catalog projected from registry blocks, shared with the SDK's own type checks. */
const CATALOG = JSON.parse(
  readFileSync(join(__dirname, '../../../../workflow-sdk/test/fixtures/catalog.json'), 'utf8')
)

const WORKFLOW_TS =
  "// @sim-sdk 1\nexport default workflow('W', {}, () => {\n  const score = fn('Score', { code: codeFile('./functions/score.js') })\n})\n"

function lockFor(...codeFiles: string[]) {
  return {
    version: 1,
    'x-tool': { pinned: true },
    blocks: Object.fromEntries(
      codeFiles.map((codeFile, order) => {
        const ident = codeFile.replace(/^functions\/|\.js$/g, '')
        return [ident, { id: `b-${order}`, parent: null, ident, order, codeFile }]
      })
    ),
    variables: {},
  }
}

const LOCK = lockFor('functions/score.js')
const FILES = { 'workflow.ts': WORKFLOW_TS, 'functions/score.js': 'return 1\n' }

function baseFor(workflowId: string, fingerprint: string) {
  return { workflowId, workspaceId: WORKSPACE_ID, fingerprint, catalogHash: CATALOG.hash }
}

function sourceResponse(files: Record<string, string> = FILES, lock: unknown = LOCK) {
  return {
    data: {
      workflowId: WORKFLOW_ID,
      workspaceId: WORKSPACE_ID,
      files,
      lock,
      base: baseFor(WORKFLOW_ID, FIRST),
      canonicalHash: 'h',
      sdkMajor: 1,
      blockTypes: ['function'],
      diagnostics: [],
    },
  }
}

function appliedResponse(
  files: Record<string, string>,
  { workflowId = WORKFLOW_ID, lock = LOCK as unknown } = {}
) {
  return {
    data: {
      workflowId,
      workflowName: 'W',
      workspaceId: WORKSPACE_ID,
      dryRun: false,
      applied: true,
      diff: {
        noop: false,
        blocks: { added: [], removed: [], renamed: [], modified: [] },
        edges: { added: 0, removed: 0 },
        variables: { added: [], removed: [], modified: [] },
      },
      diagnostics: [],
      files,
      lock,
      base: baseFor(workflowId, SECOND),
      mintedIds: {},
      notes: [],
      needsRedeployment: true,
    },
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function refusal(status: number, code: string, details?: unknown): Response {
  return json({ error: { code, message: `Refused: ${code}`, details } }, status)
}

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

async function sim(...argv: string[]): Promise<void> {
  await program().parseAsync(['node', 'sim', ...argv])
}

const get = () => sim('workflows', 'source', 'get', WORKFLOW_ID, '--dir', dir)
const apply = () => sim('workflows', 'source', 'apply', WORKFLOW_ID, '--dir', dir, '--yes')

async function refusedWith(run: () => Promise<void>): Promise<SimApiError> {
  const error = await run().catch((caught: unknown) => caught)
  expect(error).toBeInstanceOf(SimApiError)
  return error as SimApiError
}

const MANIFEST = {
  workspaceId: WORKSPACE_ID,
  tables: [
    { key: 'tickets', id: 't-1', name: 'Tickets', columns: [{ name: 'subject', type: 'string' }] },
  ],
  knowledgeBases: [],
  credentials: [{ key: 'support-slack', id: 'c-1', name: 'Support Slack', provider: 'slack' }],
  workflows: [],
  env: ['CRM_KEY'],
  truncated: false,
}

/** What the mocked server answers; each test replaces the routes it exercises. */
interface Server {
  source: () => Response
  catalog: (headers: Headers) => Response
  manifest: () => Response
  apply: () => Response
  create: () => Response
}

let root: string
let dir: string
let server: Server
let applyBodies: Array<{ files: Record<string, string>; base: { fingerprint: string } }>
let createBodies: unknown[]
let catalogRequests: Headers[]
let stderr: string[]

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'sim-source-roundtrip-'))
  dir = join(root, 'source')
  vi.stubEnv('SIM_CONFIG_DIR', join(root, 'config'))
  applyBodies = []
  createBodies = []
  catalogRequests = []
  stderr = []
  server = {
    source: () => json(sourceResponse()),
    catalog: () => json({ data: CATALOG }),
    manifest: () => json({ data: MANIFEST }),
    apply: () =>
      json(appliedResponse({ 'workflow.ts': WORKFLOW_TS, 'functions/score.js': 'return 2\n' })),
    create: () => json(appliedResponse(FILES, { workflowId: NEW_WORKFLOW_ID })),
  }
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    stderr.push(args.join(' '))
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
      const method = init?.method ?? 'GET'
      if (url.pathname === `/api/v2/workflows/${WORKFLOW_ID}/source`) {
        if (method === 'GET') return server.source()
        applyBodies.push(JSON.parse(String(init?.body)))
        return server.apply()
      }
      if (url.pathname === `/api/v2/workspaces/${WORKSPACE_ID}/workflows/source/catalog`) {
        const headers = new Headers(init?.headers)
        catalogRequests.push(headers)
        return server.catalog(headers)
      }
      if (url.pathname === `/api/v2/workspaces/${WORKSPACE_ID}/workflows/source/resources`) {
        return server.manifest()
      }
      if (url.pathname === `/api/v2/workspaces/${WORKSPACE_ID}/workflows/source`) {
        createBodies.push(JSON.parse(String(init?.body)))
        return server.create()
      }
      return new Response('not found', { status: 404 })
    })
  )
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function read(path: string): string {
  return readFileSync(join(dir, path), 'utf8')
}

describe('sim workflows source get --dir → apply --dir', () => {
  it('sends back exactly the directory get wrote, then saves what the server stored', async () => {
    await get()
    await apply()

    expect(applyBodies).toEqual([
      {
        files: FILES,
        lock: LOCK,
        base: baseFor(WORKFLOW_ID, FIRST),
        provenance: { client: 'cli' },
      },
    ])
    expect(read('functions/score.js')).toBe('return 2\n')
    expect(JSON.parse(read('.sim/base.json')).fingerprint).toBe(SECOND)
    expect(JSON.parse(read('.sim/lock.json'))).toEqual(LOCK)
    expect(readdirSync(dir).filter((name) => name.startsWith('.sim-staging-'))).toEqual([])
  })

  it('writes workspace types from the manifest, so resource keys are checked locally', async () => {
    await get()

    const types = read('.sim/sdk/workspace.d.ts')
    expect(types).toContain(`'tickets': { subject: string }`)
    expect(types).toContain(`'support-slack': { provider: 'slack' }`)
    expect(types).toContain('CRM_KEY: true')
  })

  it('creates a workflow from a bare directory, then applies to it by its new id', async () => {
    await get()
    rmSync(join(dir, '.sim/lock.json'))
    rmSync(join(dir, '.sim/base.json'))

    await sim(
      'workflows',
      'source',
      'create',
      '--dir',
      dir,
      '--name',
      'Copy',
      '--folder',
      '/Ops',
      '--yes'
    )

    expect(createBodies).toEqual([
      { files: FILES, name: 'Copy', folderPath: '/Ops', provenance: { client: 'cli' } },
    ])
    expect(existsSync(join(dir, '.sim/lock.json'))).toBe(true)
    expect(JSON.parse(read('.sim/base.json'))).toEqual(baseFor(NEW_WORKFLOW_ID, SECOND))
    await expect(apply()).rejects.toThrow(`holds the source of workflow ${NEW_WORKFLOW_ID}`)
  })
})

describe('the source directory never reaches outside --dir', () => {
  it('neither reads nor sends a code file named by a .. escape or an absolute path', async () => {
    await get()
    const secret = join(root, 'secret.js')
    writeFileSync(secret, 'SECRET')
    writeFileSync(
      join(dir, 'workflow.ts'),
      `${WORKFLOW_TS}const leak = fn('Leak', { code: codeFile('../secret.js') })\n`
    )
    const lock = lockFor('functions/score.js', secret)
    writeFileSync(join(dir, '.sim/lock.json'), JSON.stringify(lock))

    await apply()

    expect(Object.keys(applyBodies[0].files).sort()).toEqual(['functions/score.js', 'workflow.ts'])
    expect(JSON.stringify(applyBodies[0])).not.toContain('SECRET')
  })

  it('refuses a write-back the server names outside the directory, writing nothing', async () => {
    await get()
    server.apply = () =>
      json(appliedResponse({ 'workflow.ts': '// changed\n', '../escape.js': 'x' }))

    await expect(apply()).rejects.toThrow('outside')

    expect(existsSync(join(root, 'escape.js'))).toBe(false)
    expect(read('workflow.ts')).toBe(WORKFLOW_TS)
    expect(JSON.parse(read('.sim/base.json')).fingerprint).toBe(FIRST)
  })

  it.each([
    ['a code file', 'functions/score.js', 'secret.js'],
    ['the lock', '.sim/lock.json', 'secret.js'],
    ['the functions folder', 'functions', 'outside'],
  ])('refuses to apply through a symbolic link at %s, sending nothing', async (_, link, target) => {
    await get()
    mkdirSync(join(root, 'outside'))
    writeFileSync(join(root, 'outside/score.js'), 'SECRET')
    writeFileSync(join(root, 'secret.js'), 'SECRET')
    rmSync(join(dir, link), { recursive: true })
    symlinkSync(join(root, target), join(dir, link))

    const error = await refusedWith(apply)

    expect(error.code).toBe('SOURCE_SYMLINK')
    expect(applyBodies).toEqual([])
  })

  it('refuses to get through a symbolic link file, leaving its target untouched', async () => {
    await get()
    const target = join(root, 'target.js')
    writeFileSync(target, 'MINE')
    rmSync(join(dir, 'functions/score.js'))
    symlinkSync(target, join(dir, 'functions/score.js'))

    expect((await refusedWith(get)).code).toBe('SOURCE_SYMLINK')

    expect(readFileSync(target, 'utf8')).toBe('MINE')
  })

  it('refuses to get through a symbolic link folder, writing nothing where it points', async () => {
    mkdirSync(dir)
    mkdirSync(join(root, 'elsewhere'))
    symlinkSync(join(root, 'elsewhere'), join(dir, '.sim'))

    expect((await refusedWith(get)).code).toBe('SOURCE_SYMLINK')

    expect(readdirSync(join(root, 'elsewhere'))).toEqual([])
    expect(readdirSync(dir)).toEqual(['.sim'])
  })

  it("never overwrites the directory's own AGENTS.md", async () => {
    mkdirSync(dir)
    writeFileSync(join(dir, 'AGENTS.md'), '# My project\n')

    await get()

    expect(read('AGENTS.md')).toBe('# My project\n')
    expect(read('.sim/AGENTS.md')).toContain('sim workflows source apply')
  })
})

describe('line endings', () => {
  it('sends a CRLF checkout as LF, so an unchanged source stays unchanged', async () => {
    await get()
    writeFileSync(join(dir, 'workflow.ts'), WORKFLOW_TS.replace(/\n/g, '\r\n'))
    writeFileSync(join(dir, 'functions/score.js'), 'return 1\r\n')

    await apply()

    expect(applyBodies[0].files).toEqual(FILES)
  })

  it('pins the source to LF in .gitattributes, keeping what the directory already had', async () => {
    mkdirSync(dir)
    writeFileSync(join(dir, '.gitattributes'), '*.png binary')

    await get()
    await get()

    expect(read('.gitattributes')).toBe(
      '*.png binary\nworkflow.ts text eol=lf\nfunctions/** text eol=lf\n'
    )
  })
})

describe('catalog and declarations', () => {
  it('refuses a catalog for another SDK major, telling the person to upgrade, writing nothing', async () => {
    server.catalog = () => json({ data: { ...CATALOG, sdkMajor: 2 } })

    const error = await refusedWith(get)

    expect(error.message).toContain('Upgrade the CLI')
    expect(existsSync(join(dir, 'workflow.ts'))).toBe(false)
  })

  it('leaves the declarations alone while the index on disk names the same catalog', async () => {
    await get()
    writeFileSync(join(dir, '.sim/sdk/blocks/kept_block.d.ts'), 'declare const x: 1\n')

    await get()

    expect(existsSync(join(dir, '.sim/sdk/blocks/kept_block.d.ts'))).toBe(true)
  })

  it('replaces the old declarations whole when the catalog changes', async () => {
    await get()
    writeFileSync(join(dir, '.sim/sdk/blocks/retired_block.d.ts'), 'declare const x: 1\n')
    server.catalog = () => json({ data: { ...CATALOG, hash: 'changed' } })

    await get()

    expect(existsSync(join(dir, '.sim/sdk/blocks/retired_block.d.ts'))).toBe(false)
    expect(read('.sim/sdk/index.d.ts')).toContain('changed')
  })

  it('heals a torn catalog cache by fetching the catalog whole and rewriting it', async () => {
    const cache = join(root, 'config/cache/source-catalog', `${WORKSPACE_ID}.json`)
    mkdirSync(join(cache, '..'), { recursive: true })
    writeFileSync(cache, '{"hash":"torn","catalog":{"blo')

    await get()

    expect(catalogRequests[0].has('if-none-match')).toBe(false)
    expect(JSON.parse(readFileSync(cache, 'utf8')).hash).toBe(CATALOG.hash)
    expect(existsSync(join(dir, '.sim/sdk/blocks/function.d.ts'))).toBe(true)
  })

  it('removes the workspace types an earlier get wrote once the manifest is refused', async () => {
    await get()
    expect(existsSync(join(dir, '.sim/sdk/workspace.d.ts'))).toBe(true)
    server.manifest = () => refusal(403, 'FORBIDDEN')

    await get()

    expect(existsSync(join(dir, '.sim/sdk/workspace.d.ts'))).toBe(false)
    expect(existsSync(join(dir, '.sim/sdk/core.d.ts'))).toBe(true)
  })
})

describe('pruning function files', () => {
  const twoFiles = { ...FILES, 'functions/extra.js': 'return 3\n' }
  const twoLock = lockFor('functions/score.js', 'functions/extra.js')

  it('prunes, after an apply, a function file it wrote that the new lock drops', async () => {
    server.source = () => json(sourceResponse(twoFiles, twoLock))
    await get()
    writeFileSync(join(dir, 'functions/mine.js'), 'mine')

    await apply()

    expect(existsSync(join(dir, 'functions/extra.js'))).toBe(false)
    expect(read('functions/score.js')).toBe('return 2\n')
    expect(read('functions/mine.js')).toBe('mine')
  })

  it('prunes, on a fresh get, a function file the previous get wrote', async () => {
    server.source = () => json(sourceResponse(twoFiles, twoLock))
    await get()
    writeFileSync(join(dir, 'functions/mine.js'), 'mine')
    server.source = () => json(sourceResponse())

    await get()

    expect(existsSync(join(dir, 'functions/extra.js'))).toBe(false)
    expect(read('functions/mine.js')).toBe('mine')
  })
})

describe('apply refusals', () => {
  it.each([
    [409, 'SOURCE_STALE', 5],
    [423, 'WORKFLOW_LOCKED', 6],
    [413, 'SOURCE_TOO_LARGE', 7],
  ])('exits with a scriptable status on a %i, writing nothing', async (status, code, exitCode) => {
    await get()
    server.apply = () => refusal(status, code)

    const error = await refusedWith(apply)

    expect(error).toMatchObject({ status, code, exitCode })
    expect(JSON.parse(read('.sim/base.json')).fingerprint).toBe(FIRST)
  })

  it('prints each compile error as file:line:column with its frame and hint, then exits 1', async () => {
    await get()
    server.apply = () =>
      refusal(400, 'SOURCE_INVALID', {
        diagnostics: [
          {
            code: 'E_UNKNOWN_PARAM',
            severity: 'error',
            message: 'Function has no param x.',
            file: 'workflow.ts',
            line: 3,
            column: 9,
            frame: '> 3 |   const score = fn(',
            hint: 'Remove x.',
          },
        ],
      })

    const error = await refusedWith(apply)

    expect(error.exitCode).toBe(1)
    expect(stderr).toContain(
      'workflow.ts:3:9 error E_UNKNOWN_PARAM: Function has no param x.\n> 3 |   const score = fn(\n  hint: Remove x.'
    )
  })
})

describe('reading the directory', () => {
  it('refuses a directory written for another workflow, sending nothing', async () => {
    await get()
    writeFileSync(
      join(dir, '.sim/base.json'),
      JSON.stringify(baseFor('00000000-0000-4000-8000-0000000000ff', FIRST))
    )

    const error = await refusedWith(apply)

    expect(error.code).toBe('SOURCE_WORKFLOW_MISMATCH')
    expect(error.message).toContain('00000000-0000-4000-8000-0000000000ff')
    expect(applyBodies).toEqual([])
  })

  it.each([
    ['the lock is missing', () => rmSync(join(dir, '.sim/lock.json'))],
    ['the lock is not JSON', () => writeFileSync(join(dir, '.sim/lock.json'), '{')],
    ['the base is missing', () => rmSync(join(dir, '.sim/base.json'))],
    [
      'the base has no fingerprint',
      () => writeFileSync(join(dir, '.sim/base.json'), JSON.stringify({ workflowId: WORKFLOW_ID })),
    ],
    [
      'the base names no workflow',
      () => writeFileSync(join(dir, '.sim/base.json'), JSON.stringify({ fingerprint: FIRST })),
    ],
  ])('points at source get when %s, sending nothing', async (_, damage) => {
    await get()
    damage()

    const error = await refusedWith(apply)

    expect(error.message).toContain('sim workflows source get')
    expect(applyBodies).toEqual([])
  })

  it('sends the source without a referenced function file that is missing, for the server to locate', async () => {
    await get()
    rmSync(join(dir, 'functions/score.js'))

    await apply()

    expect(applyBodies[0].files).toEqual({ 'workflow.ts': WORKFLOW_TS })
  })
})
