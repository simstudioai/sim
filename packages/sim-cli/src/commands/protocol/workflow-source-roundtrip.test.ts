import { createHash } from 'node:crypto'
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
import { compileWorkflow } from '@sim/workflow-code'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SimApiError } from '../../http/client'
import { buildGeneratedCommands } from '../../runtime/build'
import { attachProtocolCommands } from './index'

/** The profile every command resolves; a test that reads display output sets `output` to text. */
const profile = vi.hoisted(() => ({
  name: 'default',
  endpoint: 'https://sim.example',
  authProfile: 'default',
  apiKey: 'key',
  oauth: null,
  workspaceId: '00000000-0000-4000-8000-00000000000b',
  output: 'json' as 'json' | 'text',
  sources: {
    endpoint: 'default' as const,
    credential: 'env' as const,
    workspaceId: 'env' as const,
    output: 'default' as const,
  },
}))

vi.mock('../../context', async () => {
  const { SimClient } = await import('../../http/client')
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
  "// @sim-sdk 1\nimport { codeFile, fn, workflow } from '@sim/workflow-sdk'\n\nexport default workflow('W', {}, () => {\n  const score = fn('Score', { code: codeFile('./functions/score.js') })\n})\n"

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
  return {
    version: 1,
    workflowId,
    workspaceId: WORKSPACE_ID,
    fingerprint,
    catalogHash: CATALOG.hash,
  }
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
        variables: { added: [], removed: [], renamed: [], modified: [] },
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
    {
      key: 'tickets',
      id: 't-1',
      name: 'Tickets',
      columns: [
        { name: 'subject', type: 'string' },
        { name: 'status', type: 'string', required: true },
      ],
    },
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
  catalog: (headers: Headers, url: URL) => Response
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
  profile.output = 'json'
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
        return server.catalog(headers, url)
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

  it('reports what get wrote under the field names a create scaffold uses, with the guide', async () => {
    await get()

    const printed = JSON.parse(vi.mocked(console.log).mock.calls.at(-1)?.join(' ') ?? '{}')
    expect(printed).toMatchObject({ workflowId: WORKFLOW_ID, guide: '.sim/AGENTS.md' })
    expect(printed.files).toBeGreaterThan(0)
  })

  it('writes workspace types from the manifest, so resource keys are checked locally', async () => {
    await get()

    const types = read('.sim/sdk/workspace.d.ts')
    expect(types).toContain(`'tickets': { status: string; subject: string | null }`)
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

    await apply()

    expect(Object.keys(applyBodies[0].files).sort()).toEqual(['functions/score.js', 'workflow.ts'])
    expect(JSON.stringify(applyBodies[0])).not.toContain('SECRET')
  })

  it('refuses a lock naming a code file outside the directory before sending anything', async () => {
    await get()
    writeFileSync(join(root, 'secret.js'), 'SECRET')
    const lock = lockFor('functions/score.js', join(root, 'secret.js'))
    writeFileSync(join(dir, '.sim/lock.json'), JSON.stringify(lock))

    await expect(apply()).rejects.toThrow('is not a valid lock')

    expect(applyBodies).toEqual([])
  })

  it('never writes a stored write-back path outside the directory, and still records the write', async () => {
    await get()
    server.apply = () =>
      json(appliedResponse({ 'workflow.ts': '// changed\n', '../escape.js': 'x' }))

    await apply()

    expect(existsSync(join(root, 'escape.js'))).toBe(false)
    expect(read('workflow.ts')).toBe('// changed\n')
    expect(JSON.parse(read('.sim/base.json')).fingerprint).not.toBe(FIRST)
    expect(stderr.join('\n')).toContain('the answer named ../escape.js, which the CLI never writes')
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

describe('the files a server answer may write', () => {
  it.each([
    '.git/hooks/pre-commit',
    'conftest.py',
    'functions/../.env',
    'functions/nested/x.js',
    'functions/x.ts',
    'lib/x.js',
  ])('refuses a get answer naming %s, writing nothing', async (path) => {
    server.source = () => json(sourceResponse({ ...FILES, [path]: 'planted' }))

    await expect(get()).rejects.toThrow('unsafe file path')

    expect(existsSync(dir)).toBe(false)
  })

  it('never writes an apply answer file the printer never writes, and still records the write', async () => {
    await get()
    server.apply = () => json(appliedResponse({ ...FILES, '.git/hooks/pre-commit': 'planted' }))

    await apply()

    expect(existsSync(join(dir, '.git'))).toBe(false)
    expect(JSON.parse(read('.sim/base.json')).fingerprint).not.toBe(FIRST)
    expect(stderr.join('\n')).toContain(
      'the answer named .git/hooks/pre-commit, which the CLI never writes'
    )
  })
})

describe('line endings', () => {
  it('sends a file saved with a byte-order mark without it, so its header still reads', async () => {
    await get()
    writeFileSync(join(dir, 'workflow.ts'), `\uFEFF${WORKFLOW_TS}`)

    await apply()

    expect(applyBodies[0].files['workflow.ts']).toBe(WORKFLOW_TS)
  })

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

describe('the workspace-scoped source reads', () => {
  it.each(['resources', 'catalog'])(
    'reads %s from the profile workspace, like every other workspace route',
    async (command) => {
      await sim('workflows', 'source', command)

      const urls = vi.mocked(fetch).mock.calls.map(([input]) => String(input))
      expect(urls).toEqual([
        `https://sim.example/api/v2/workspaces/${WORKSPACE_ID}/workflows/source/${command}`,
      ])
    }
  )
})

describe('catalog and declarations', () => {
  it('types a workflow created since the get once an apply talks to the server', async () => {
    await get()
    expect(read('.sim/sdk/workspace.d.ts')).not.toContain("'handbook-answer'")
    const child = { key: 'handbook-answer', id: 'wf-child', name: 'Handbook Answer', inputs: [] }
    server.manifest = () => json({ data: { ...MANIFEST, workflows: [child] } })

    await sim('workflows', 'source', 'apply', WORKFLOW_ID, '--dir', dir, '--yes')

    expect(read('.sim/sdk/workspace.d.ts')).toContain("'handbook-answer'")
    expect(JSON.parse(read('.sim/sdk/workspace.manifest.json')).workflows).toHaveProperty(
      'handbook-answer'
    )
  })

  it('refuses a catalog for another SDK major, telling the person to upgrade, writing nothing', async () => {
    server.catalog = () => json({ data: { ...CATALOG, sdkMajor: 2 } })

    const error = await refusedWith(get)

    expect(error.message).toContain('Upgrade the CLI')
    expect(existsSync(join(dir, 'workflow.ts'))).toBe(false)
  })

  it('drops the file of a block the source no longer uses while the index names the same catalog', async () => {
    await get()
    writeFileSync(join(dir, '.sim/sdk/blocks/unused_block.d.ts'), 'declare const x: 1\n')

    await get()

    expect(existsSync(join(dir, '.sim/sdk/blocks/unused_block.d.ts'))).toBe(false)
    expect(existsSync(join(dir, '.sim/sdk/blocks/agent.d.ts'))).toBe(true)
  })

  it('regenerates the declarations for the same catalog when another CLI release generated them', async () => {
    await get()
    const index = read('.sim/sdk/index.d.ts').split('\n')
    index[1] = '// generated by sim 0.0.1 · core.d.ts 0000000000000000'
    writeFileSync(join(dir, '.sim/sdk/index.d.ts'), index.join('\n'))
    writeFileSync(join(dir, '.sim/sdk/blocks/retired_block.d.ts'), 'declare const x: 1\n')

    await get()

    expect(existsSync(join(dir, '.sim/sdk/blocks/retired_block.d.ts'))).toBe(false)
    expect(read('.sim/sdk/index.d.ts').split('\n')[1]).not.toContain('sim 0.0.1')
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
    const cache = join(root, 'config/cache/source-catalog', `${CATALOG.hash}.json`)
    mkdirSync(join(cache, '../workspaces'), { recursive: true })
    writeFileSync(
      join(cache, '../workspaces', `${WORKSPACE_ID}.json`),
      JSON.stringify({ hash: CATALOG.hash })
    )
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

  it('keeps, and names, a code file the edit added that the printed source no longer names', async () => {
    await get()
    writeFileSync(join(dir, 'functions/leak.js'), 'const token = "ghp_secret"\nreturn token\n')
    writeFileSync(
      join(dir, 'workflow.ts'),
      WORKFLOW_TS.replace(
        '})\n})',
        "})\n  const leak = fn('Leak', { code: codeFile('./functions/leak.js') })\n})"
      )
    )
    const stored = WORKFLOW_TS.replace(
      '})\n})',
      "})\n  const leak = fn('Leak', { code: stored() })\n})"
    )
    server.apply = () => json(appliedResponse({ ...FILES, 'workflow.ts': stored }))

    await apply()

    expect(read('functions/leak.js')).toContain('ghp_secret')
    expect(stderr.join('\n')).toContain(
      'warning: functions/leak.js is no longer named by workflow.ts'
    )
    expect(stderr.join('\n')).not.toContain('functions/score.js is no longer named')
  })

  it('never prunes a file of the author a hand-edited lock gives to a block', async () => {
    await get()
    writeFileSync(join(dir, 'functions/mine.js'), 'mine')
    const handEdited = JSON.parse(read('.sim/lock.json'))
    handEdited.blocks.start = {
      id: 'b-start',
      parent: null,
      ident: 'start',
      order: 9,
      codeFile: 'functions/mine.js',
    }
    writeFileSync(join(dir, '.sim/lock.json'), JSON.stringify(handEdited))

    await apply()

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

describe('a get into a directory that already holds source', () => {
  const EDITED = `${WORKFLOW_TS}// my unapplied edit\n`
  const CHANGED = { ...FILES, 'workflow.ts': `${WORKFLOW_TS}// changed on the server\n` }

  it('replaces source it wrote that nobody edited', async () => {
    await get()
    writeFileSync(join(dir, 'workflow.ts'), WORKFLOW_TS.replace(/\n/g, '\r\n'))
    server.source = () => json(sourceResponse(CHANGED))

    await get()

    expect(read('workflow.ts')).toBe(CHANGED['workflow.ts'])
  })

  it('replaces function code stored with CRLF that nobody edited', async () => {
    const crlf = { ...FILES, 'functions/score.js': 'return 1\r\n' }
    server.source = () => json(sourceResponse(crlf))
    await get()
    server.source = () => json(sourceResponse({ ...FILES, 'functions/score.js': 'return 2\r\n' }))

    await get()

    expect(read('functions/score.js')).toBe('return 2\r\n')
  })

  it('replaces unedited CRLF function code an older CLI recorded with its raw digest', async () => {
    const crlf = { ...FILES, 'functions/score.js': 'return 1\r\n' }
    server.source = () => json(sourceResponse(crlf))
    await get()
    const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')
    writeFileSync(
      join(dir, '.sim/written.json'),
      JSON.stringify({
        version: 1,
        files: Object.fromEntries(Object.entries(crlf).map(([path, text]) => [path, sha256(text)])),
      })
    )

    await get()

    expect(read('functions/score.js')).toBe('return 1\r\n')
  })

  it('refuses to overwrite an unapplied edit, such as the one a stale apply refused', async () => {
    await get()
    writeFileSync(join(dir, 'workflow.ts'), EDITED)
    server.source = () => json(sourceResponse(CHANGED))

    const error = await refusedWith(get)

    expect(error.code).toBe('SOURCE_LOCAL_EDITS')
    expect(error.message).toContain('workflow.ts')
    expect(read('workflow.ts')).toBe(EDITED)
  })

  it('refuses to overwrite a workflow.ts it never wrote', async () => {
    mkdirSync(dir)
    writeFileSync(join(dir, 'workflow.ts'), EDITED)

    expect((await refusedWith(get)).code).toBe('SOURCE_LOCAL_EDITS')

    expect(read('workflow.ts')).toBe(EDITED)
  })

  it('refuses to prune an edited function file the new source drops', async () => {
    server.source = () =>
      json(
        sourceResponse(
          { ...FILES, 'functions/extra.js': 'return 3\n' },
          lockFor('functions/score.js', 'functions/extra.js')
        )
      )
    await get()
    writeFileSync(join(dir, 'functions/extra.js'), 'return 4\n')
    server.source = () => json(sourceResponse())

    expect((await refusedWith(get)).code).toBe('SOURCE_LOCAL_EDITS')

    expect(read('functions/extra.js')).toBe('return 4\n')
  })

  it('overwrites the edit with --force', async () => {
    await get()
    writeFileSync(join(dir, 'workflow.ts'), EDITED)
    server.source = () => json(sourceResponse(CHANGED))

    await sim('workflows', 'source', 'get', WORKFLOW_ID, '--dir', dir, '--force')

    expect(read('workflow.ts')).toBe(CHANGED['workflow.ts'])
  })

  it("refuses a directory holding another workflow's source, before reading anything", async () => {
    await get()
    writeFileSync(
      join(dir, '.sim/base.json'),
      JSON.stringify(baseFor('00000000-0000-4000-8000-0000000000ff', FIRST))
    )
    const calls = vi.mocked(fetch).mock.calls.length

    const error = await refusedWith(get)

    expect(error.code).toBe('SOURCE_WORKFLOW_MISMATCH')
    expect(vi.mocked(fetch).mock.calls.length).toBe(calls)
  })

  it("keeps the directory's own tsconfig.json, and refreshes the one it wrote", async () => {
    mkdirSync(dir)
    writeFileSync(join(dir, 'tsconfig.json'), '{ "extends": "../tsconfig.base.json" }\n')
    await get()
    expect(read('tsconfig.json')).toBe('{ "extends": "../tsconfig.base.json" }\n')
    expect(stderr.some((line) => line.includes('tsconfig.json'))).toBe(true)

    rmSync(join(dir, 'tsconfig.json'))
    await get()
    const written = read('tsconfig.json')
    writeFileSync(join(dir, 'tsconfig.json'), written.replace('ES2022', 'ES2020'))
    await get()

    expect(read('tsconfig.json')).toBe(written)
  })
})

describe('reading a workflow too large to print', () => {
  it.each([
    ['--dir', true],
    ['the printed response', false],
  ])('exits 7 for %s', async (_, withDir) => {
    server.source = () => refusal(413, 'SOURCE_TOO_LARGE')

    const error = await refusedWith(() =>
      withDir ? get() : sim('workflows', 'source', 'get', WORKFLOW_ID)
    )

    expect(error).toMatchObject({ status: 413, exitCode: 7 })
  })
})

describe('creating a workflow from a bare directory', () => {
  it('leaves the directory ready to edit: types, tsconfig.json and the agent guide', async () => {
    mkdirSync(dir)
    writeFileSync(join(dir, 'workflow.ts'), WORKFLOW_TS)
    mkdirSync(join(dir, 'functions'))
    writeFileSync(join(dir, 'functions/score.js'), 'return 1\n')

    await sim('workflows', 'source', 'create', '--dir', dir, '--yes')

    expect(existsSync(join(dir, '.sim/sdk/core.d.ts'))).toBe(true)
    expect(existsSync(join(dir, '.sim/sdk/blocks/function.d.ts'))).toBe(true)
    expect(existsSync(join(dir, '.sim/sdk/workspace.d.ts'))).toBe(true)
    expect(existsSync(join(dir, 'tsconfig.json'))).toBe(true)
    expect(existsSync(join(dir, '.sim/AGENTS.md'))).toBe(true)
  })

  it('writes an agent guide whose workflow skeleton compiles', async () => {
    await get()
    const skeleton = /```ts\n([\s\S]*?)```/.exec(read('.sim/AGENTS.md'))?.[1]
    expect(skeleton).toBeDefined()

    const result = compileWorkflow({
      entry: { path: 'workflow.ts', text: skeleton ?? '' },
      files: new Map(),
      catalog: CATALOG,
      sdkMajor: 1,
    })

    expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([])
  })
})

describe('apply refusals', () => {
  it.each([
    [409, { code: 'SOURCE_STALE', currentFingerprint: SECOND }, 5],
    [409, undefined, 1],
    [423, undefined, 6],
    [413, undefined, 7],
  ])(
    'exits with a scriptable status on a %i (%o), writing nothing',
    async (status, details, exitCode) => {
      await get()
      server.apply = () => refusal(status, 'REFUSED', details)

      const error = await refusedWith(apply)

      expect(error).toMatchObject({ status, exitCode })
      expect(JSON.parse(read('.sim/base.json')).fingerprint).toBe(FIRST)
    }
  )

  it('exits 1 when a create finds the name taken, pointing at --name rather than a fresh get', async () => {
    mkdirSync(dir)
    writeFileSync(join(dir, 'workflow.ts'), WORKFLOW_TS)
    server.create = () => refusal(409, 'CONFLICT', { code: 'SOURCE_NAME_TAKEN', name: 'W' })

    const error = await refusedWith(() =>
      sim('workflows', 'source', 'create', '--dir', dir, '--yes')
    )

    expect(error).toMatchObject({ status: 409, exitCode: 1 })
    expect(error.message).toContain('--name')
  })

  it('prints each compile error as file:line:column with its frame and hint, then exits 1', async () => {
    await get()
    profile.output = 'text'
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

/**
 * The block types the workspace catalog withholds from the caller (an unrevealed preview, an
 * allowlist) while a stored workflow still holds them: only that workflow's own source catalog,
 * which the get fetches with `workflowId`, declares them, and the dry run compiles against it.
 */
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

/** Every builder path of a withheld type, in catalog order. */
const WITHHELD_BUILDERS = Object.entries(CATALOG.builders as Record<string, { type: string }>)
  .filter(([, builder]) => WITHHELD_TYPES.has(builder.type))
  .map(([path]) => path)

/** A ticket router as a get prints it: a condition whose else branch writes a table row. */
const TICKET_ROUTER = `// @sim-sdk 1
import {
  condition,
  js,
  knowledge,
  knowledgeBase,
  response,
  t,
  table,
  trigger,
  workflow,
} from '@sim/workflow-sdk'

export default workflow('Ticket Router', {}, () => {
  const start = trigger.start('Start', { inputFormat: { subject: 'string', priority: 'string' } })
  const isUrgent = condition('Is Urgent', { if: js\`\${start.priority} === 'high'\`, else: true })
  const policy = knowledge.search('Policy', {
    knowledgeBaseId: knowledgeBase('policies'),
    query: start.subject,
  })
  const logTicket = table.insertRow('Log Ticket', {
    tableId: table('tickets'),
    data: { subject: start.subject, status: 'open' },
  })
  const upsertTicket = table.upsertRow('Upsert Ticket', {
    tableId: table('tickets'),
    data: { subject: start.subject, status: 'open' },
  })
  const recent = table.queryRows('Recent Tickets', { tableId: table('tickets'), limit: 10 })
  const done = response('Done', { body: { rowId: t\`\${logTicket.row.id}\`, rows: recent.rows } })

  start.to(isUrgent)
  isUrgent.if.to(policy)
  isUrgent.else.to(logTicket)
  logTicket.to(upsertTicket)
  upsertTicket.to(recent)
  recent.to(done)
})
`

/** One block of every withheld builder, each with no params, as an edit could add them. */
const EVERY_WITHHELD_BUILDER = [
  '// @sim-sdk 1',
  "import { knowledge, table, trigger, workflow } from '@sim/workflow-sdk'",
  '',
  "export default workflow('Every Builder', {}, () => {",
  ...WITHHELD_BUILDERS.map((path, index) => `  const b${index} = ${path}('Block ${index}', {})`),
  '})',
  '',
].join('\n')

const check = (...flags: string[]) => sim('workflows', 'source', 'check', '--dir', dir, ...flags)

function checked(): { errors: number; warnings: number; diagnostics: unknown[] } {
  return JSON.parse(vi.mocked(console.log).mock.calls.at(-1)?.join(' ') ?? '{}')
}

describe('checking a workflow holding a type the workspace catalog withholds', () => {
  afterEach(() => {
    process.exitCode = undefined
  })

  beforeEach(() => {
    server.catalog = (_, url) =>
      json({ data: url.searchParams.has('workflowId') ? CATALOG : WORKSPACE_CATALOG })
  })

  function serve(source: string, catalogHash: string = CATALOG.hash): void {
    const { data } = sourceResponse(
      { 'workflow.ts': source },
      { version: 1, blocks: {}, variables: {} }
    )
    server.source = () =>
      json({
        data: {
          ...data,
          base: { ...data.base, catalogHash },
          blockTypes: ['start_trigger', 'condition', 'response', ...WITHHELD_TYPES],
        },
      })
  }

  it('passes the unedited source of a get, with the else branch wired to the table write', async () => {
    serve(TICKET_ROUTER)
    await get()

    await check()

    expect(checked()).toMatchObject({ errors: 0, warnings: 0, diagnostics: [] })
    expect(process.exitCode).toBeUndefined()
  })

  it('finds what the dry run finds for every builder only the workflow catalog declares', async () => {
    serve(EVERY_WITHHELD_BUILDER)
    await get()
    const dryRun = compileWorkflow({
      entry: { path: 'workflow.ts', text: EVERY_WITHHELD_BUILDER },
      files: new Map(),
      catalog: CATALOG,
      sdkMajor: CATALOG.sdkMajor,
    }).diagnostics.map(({ code, message, span }) => ({ code, message, line: span?.line }))

    await check('--no-strict')

    expect(WITHHELD_BUILDERS).toEqual(
      expect.arrayContaining(['table.insertRow', 'knowledge.search'])
    )
    expect(dryRun.map(({ code }) => code)).not.toContain('E_UNKNOWN_BUILDER')
    expect(
      (checked().diagnostics as Array<{ code: string; message: string; line?: number }>).map(
        ({ code, message, line }) => ({ code, message, line })
      )
    ).toEqual(dryRun)
  })

  it('caches each catalog once by its hash, fetching the workflow catalog only while uncached', async () => {
    const cacheDir = join(root, 'config/cache/source-catalog')
    mkdirSync(join(cacheDir, WORKSPACE_ID), { recursive: true })
    writeFileSync(join(cacheDir, `${WORKSPACE_ID}.json`), '{}')
    serve(TICKET_ROUTER)
    const queries: string[] = []
    const answer = server.catalog
    server.catalog = (headers, url) => {
      queries.push(url.searchParams.get('workflowId') ?? 'workspace')
      return answer(headers, url)
    }

    await get()
    await get()

    expect(readdirSync(cacheDir).sort()).toEqual(
      [CATALOG.hash, `${CATALOG.hash}.json`, `${WORKSPACE_CATALOG.hash}.json`, 'workspaces'].sort()
    )
    expect(queries.filter((query) => query === WORKFLOW_ID)).toHaveLength(1)
  })

  it('checks against the workspace catalog again once a later get no longer needs its own', async () => {
    serve(TICKET_ROUTER)
    await get()
    const revealed = { ...CATALOG, hash: 'revealed' }
    server.catalog = () => json({ data: revealed })
    serve(TICKET_ROUTER, revealed.hash)
    await get()

    await check()

    expect(checked()).toMatchObject({ errors: 0, catalogHash: revealed.hash })
  })
})

/** A get's source holding a stored cycle between A and B, every block bound by the lock. */
const STORED_CYCLE = `// @sim-sdk 1
import { api, trigger, workflow } from '@sim/workflow-sdk'

export default workflow('W', {}, () => {
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

const STORED_CYCLE_LOCK = {
  version: 1,
  blocks: Object.fromEntries(
    ['start', 'a', 'b', 'c'].map((key, order) => [
      key,
      { id: `id-${key}`, parent: null, ident: key, order },
    ])
  ),
  variables: {},
}

describe('checking wiring between blocks the lock binds', () => {
  beforeEach(() => {
    server.source = () =>
      json({
        data: {
          ...sourceResponse({ 'workflow.ts': STORED_CYCLE }, STORED_CYCLE_LOCK).data,
          blockTypes: ['start_trigger', 'api'],
        },
      })
  })

  afterEach(() => {
    process.exitCode = undefined
  })

  const check = (...flags: string[]) => sim('workflows', 'source', 'check', '--dir', dir, ...flags)

  function codes(): string[] {
    const printed = JSON.parse(vi.mocked(console.log).mock.calls.at(-1)?.join(' ') ?? '{}')
    return (printed.diagnostics as Array<{ code: string }>).map(({ code }) => code)
  }

  function edit(change: (source: string) => string): void {
    writeFileSync(join(dir, 'workflow.ts'), change(read('workflow.ts')))
  }

  it('refuses a cycle the edit closes between bound blocks, as the dry run does', async () => {
    await get()
    edit((source) => source.replace('  b.to(c)\n', '  b.to(c)\n  c.to(b)\n'))

    await check('--strict')

    expect(codes()).toEqual(['E_EDGE_CYCLE'])
    expect(process.exitCode).toBe(1)
  })

  it('keeps the cycle the get printed a warning', async () => {
    await get()

    await check('--strict')

    expect(codes()).toEqual(['W_EDGE_CYCLE'])
    expect(process.exitCode).toBeUndefined()
  })

  it('keeps the printed cycle a warning through a block renamed in source', async () => {
    await get()
    edit((source) => source.replace("api('B',", "api('Bee',"))

    await check('--strict')

    expect(codes()).toEqual(['W_EDGE_CYCLE'])
    expect(process.exitCode).toBeUndefined()
  })

  it('records the edges an apply printed, for the base it saves', async () => {
    await get()
    server.apply = () =>
      json(appliedResponse({ 'workflow.ts': STORED_CYCLE }, { lock: STORED_CYCLE_LOCK }))
    await apply()
    edit((source) => source.replace('  b.to(c)\n', '  b.to(c)\n  c.to(b)\n'))

    await check()

    expect(JSON.parse(read('.sim/stored-edges.json')).fingerprint).toBe(SECOND)
    expect(codes()).toEqual(['E_EDGE_CYCLE'])
  })
})
