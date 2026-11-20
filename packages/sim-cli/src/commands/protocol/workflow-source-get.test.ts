import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { COOKBOOK_EXAMPLES } from '@sim/workflow-sdk/codegen'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SimApiError } from '../../http/client'
import { buildProgram } from '../../program'
import { buildGeneratedCommands } from '../../runtime/build'
import { contextMockFns, contextMockState, mockedProfile } from '../../test/context-mock'
import { digest } from './source-dir'
import { PRIMER_MAX_BYTES, sourcePrimer } from './source-primer'
import { attachWorkflowSourceCheck } from './workflow-source-check'
import { attachWorkflowSourceGet } from './workflow-source-get'

vi.mock('../../context', async () => (await import('../../test/context-mock')).contextMock)

const { mockRequest: request } = contextMockFns

const WORKFLOW_ID = '00000000-0000-4000-8000-00000000000a'
const WORKSPACE_ID = '00000000-0000-4000-8000-00000000000b'
const SOURCE_PATH = `/api/v2/workflows/${WORKFLOW_ID}/source`
const CATALOG_PATH = `/api/v2/workspaces/${WORKSPACE_ID}/workflows/source/catalog`
const MANIFEST_PATH = `/api/v2/workspaces/${WORKSPACE_ID}/workflows/source/resources`

/** A real catalog projected from registry blocks, shared with the SDK's own type checks. */
const CATALOG = JSON.parse(
  readFileSync(join(__dirname, '../../../../workflow-sdk/test/fixtures/catalog.json'), 'utf8')
)

function source(
  files: Record<string, string> = { 'workflow.ts': '// @sim-sdk 1\n' },
  blockTypes: string[] = ['agent']
) {
  return {
    data: {
      workflowId: WORKFLOW_ID,
      workspaceId: WORKSPACE_ID,
      files,
      lock: { version: 1, blocks: {}, variables: {} },
      base: {
        workflowId: WORKFLOW_ID,
        workspaceId: WORKSPACE_ID,
        fingerprint: 'sf1:x',
        catalogHash: CATALOG.hash,
      },
      canonicalHash: 'h',
      sdkMajor: 1,
      blockTypes,
      diagnostics: [],
    },
  }
}

function program(): Command {
  const root = new Command('sim')
  for (const command of buildGeneratedCommands()) root.addCommand(command)
  const workflows = root.commands.find((command) => command.name() === 'workflows')
  const sourceGroup = workflows?.commands.find((command) => command.name() === 'source')
  if (!sourceGroup) throw new Error('workflows source group missing')
  attachWorkflowSourceGet(sourceGroup)
  const override = (command: Command) => {
    command.exitOverride()
    command.commands.forEach(override)
  }
  override(root)
  return root
}

/** Type-checks the output directory with one of its tsconfig files; returns tsc's output, or ''. */
function typecheck(project: string): string {
  try {
    execFileSync(
      join(__dirname, '../../../../../node_modules/.bin/tsc'),
      ['--noEmit', '-p', join(outDir, project)],
      { encoding: 'utf8', stdio: 'pipe' }
    )
    return ''
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string }
    return `${failure.stdout ?? ''}${failure.stderr ?? ''}`
  }
}

/** The `include` list of a tsconfig the CLI wrote into the output directory. */
function tsconfigInclude(project: string): string[] {
  const [, ...json] = readFileSync(join(outDir, project), 'utf8').split('\n')
  return JSON.parse(json.join('\n')).include
}

/** `command`'s parents, nearest first. */
function ancestorsOf(command: Command): Command[] {
  const ancestors: Command[] = []
  for (let at = command.parent; at; at = at.parent) ancestors.push(at)
  return ancestors
}

async function get(...argv: string[]): Promise<void> {
  await program().parseAsync(['node', 'sim', 'workflows', 'source', 'get', WORKFLOW_ID, ...argv])
}

let rootDir: string
let outDir: string

const MANIFEST = {
  data: {
    workspaceId: WORKSPACE_ID,
    tables: [],
    knowledgeBases: [{ key: 'docs', id: 'kb-1', name: 'Docs' }],
    credentials: [],
    workflows: [],
    skills: [{ key: 'triage', id: 'skill-1', name: 'Triage' }],
    customTools: [{ key: 'lookup-order', id: 'tool-1', name: 'lookup_order' }],
    env: [],
    truncated: false,
  },
}

/** Serves the source, the catalog and the manifest by path; `overrides` replaces any of them. */
function serve(overrides: Partial<Record<string, () => unknown>> = {}) {
  request.mockImplementation(async (path: string) => {
    const override = overrides[path]
    if (override) return override()
    if (path === SOURCE_PATH) return source()
    if (path === CATALOG_PATH) return { data: CATALOG }
    if (path === MANIFEST_PATH) return MANIFEST
    throw new Error(`unexpected request ${path}`)
  })
}

function callsTo(path: string) {
  return request.mock.calls.filter((call) => call[0] === path)
}

beforeEach(() => {
  contextMockState.output = 'json'
  request.mockReset()
  rootDir = mkdtempSync(join(tmpdir(), 'sim-source-'))
  outDir = join(rootDir, 'out')
  vi.stubEnv('SIM_CONFIG_DIR', join(rootDir, 'config'))
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  rmSync(rootDir, { recursive: true, force: true })
})

describe('sim workflows source get --dir', () => {
  it('writes the source, lock, base, an agent guide and the declarations of the blocks it uses', async () => {
    serve({
      [SOURCE_PATH]: () =>
        source({ 'workflow.ts': '// @sim-sdk 1\n', 'functions/score.js': 'return 1\n' }),
    })

    await get('--dir', outDir)

    expect(readFileSync(join(outDir, 'functions/score.js'), 'utf8')).toBe('return 1\n')
    expect(JSON.parse(readFileSync(join(outDir, '.sim/lock.json'), 'utf8')).version).toBe(1)
    expect(JSON.parse(readFileSync(join(outDir, '.sim/base.json'), 'utf8')).fingerprint).toBe(
      'sf1:x'
    )
    expect(existsSync(join(outDir, '.sim/sdk/core.d.ts'))).toBe(true)
    expect(existsSync(join(outDir, '.sim/sdk/blocks/agent.d.ts'))).toBe(true)
    expect(existsSync(join(outDir, '.sim/sdk/blocks/slack_v2.d.ts'))).toBe(false)
    const workspaceTypes = readFileSync(join(outDir, '.sim/sdk/workspace.d.ts'), 'utf8')
    expect(workspaceTypes).toContain("'docs': true")
    expect(workspaceTypes).toContain("interface WorkspaceSkills {\n    'triage': true")
    expect(workspaceTypes).toContain("interface WorkspaceCustomTools {\n    'lookup-order': true")
    expect(callsTo(CATALOG_PATH)).toHaveLength(1)
    expect(callsTo(CATALOG_PATH)[0][1].query).toBeUndefined()
  })

  it('prints the primer, which opens the guide, with a snippet for each builder the source calls and no other', async () => {
    serve({
      [SOURCE_PATH]: () =>
        source({ 'workflow.ts': "// @sim-sdk 1\nconst mail = gmail.sendEmail('Mail', {})\n" }),
    })

    await get('--dir', outDir)

    const { primer } = JSON.parse(vi.mocked(console.log).mock.calls.at(-1)?.join(' ') ?? '{}')
    expect(readFileSync(join(outDir, '.sim/AGENTS.md'), 'utf8').startsWith(primer)).toBe(true)
    expect(primer).toContain('- `gmail.sendEmail` (Gmail: Send Email)')
    expect(primer).not.toContain('`slack.sendMessage`')
  })

  it.each(['workflow', 'workspace'] as const)(
    'names in the %s primer only commands and flags this CLI has',
    (kind) => {
      const program = buildProgram()
      const named = [...sourcePrimer(kind).matchAll(/`(sim [^`]+)`/g)].map((match) => match[1])
      expect(named.length).toBeGreaterThan(0)
      for (const line of named) {
        let command: Command = program
        const words = line.split(/\s+/).slice(1)
        for (const word of words) {
          if (word.startsWith('-') || word.startsWith('<') || /^['"{.]/.test(word)) break
          const next = command.commands.find(
            (child) => child.name() === word || child.aliases().includes(word)
          )
          if (!next) break
          command = next
        }
        expect(command.commands.length, `${line} names a command`).toBe(0)
        const flags = new Set(
          [command, ...ancestorsOf(command)].flatMap((at) =>
            at.options.map((option) => option.long)
          )
        )
        for (const flag of line.match(/--[a-z-]+/g) ?? []) {
          expect(
            flags.has(flag) || flags.has(flag.replace(/^--no-/, '--')),
            `${line}: ${flag}`
          ).toBe(true)
        }
      }
    }
  )

  it('keeps the primer without snippets within its byte budget for both directory kinds', () => {
    for (const kind of ['workflow', 'workspace'] as const) {
      expect(Buffer.byteLength(sourcePrimer(kind))).toBeLessThanOrEqual(PRIMER_MAX_BYTES)
    }
  })

  it('type-checks a builder of a block the directory does not hold: through the cache at once, and locally after a check', async () => {
    const workflow = [
      '// @sim-sdk 1',
      "import { trigger, workflow } from '@sim/workflow-sdk'",
      '',
      "export default workflow('W', {}, () => {",
      "  const start = trigger.start('Start', {})",
      '})',
      '',
    ].join('\n')
    serve({ [SOURCE_PATH]: () => source({ 'workflow.ts': workflow }, []) })
    await get('--dir', outDir)
    expect(existsSync(join(outDir, '.sim/sdk/blocks/gmail_v2.d.ts'))).toBe(false)

    writeFileSync(
      join(outDir, 'workflow.ts'),
      workflow
        .replace('{ trigger, workflow }', '{ gmail, trigger, workflow }')
        .replace(
          "  const start = trigger.start('Start', {})\n",
          "  const start = trigger.start('Start', {})\n  const mail = gmail.sendEmail('Mail', { to: 'a@b.c', subject: 's', body: 'b', bogusParam: 1 })\n  start.to(mail)\n"
        )
    )
    const unknownParam = /'bogusParam' does not exist in type 'GmailSendEmailParams'/
    expect(typecheck('tsconfig.full.json')).toMatch(unknownParam)

    contextMockFns.mockProfileFrom.mockReturnValue({
      ...mockedProfile(),
      workspaceId: WORKSPACE_ID,
      output: 'json',
    })
    const check = new Command('source')
    attachWorkflowSourceCheck(check)
    check.commands.forEach((command) => command.exitOverride())
    await check.parseAsync(['node', 'source', 'check', '--dir', outDir])
    process.exitCode = undefined

    expect(existsSync(join(outDir, '.sim/sdk/blocks/gmail_v2.d.ts'))).toBe(true)
    expect(typecheck('tsconfig.json')).toMatch(unknownParam)
  })

  it('writes the example workflows beside the guide, outside what the tsconfig files type-check', async () => {
    serve()

    await get('--dir', outDir)

    for (const [file, text] of Object.entries(COOKBOOK_EXAMPLES)) {
      expect(readFileSync(join(outDir, '.sim/examples', file), 'utf8')).toBe(text)
    }
    for (const project of ['tsconfig.json', 'tsconfig.full.json']) {
      const [marker] = readFileSync(join(outDir, project), 'utf8').split('\n')
      expect(marker).toContain('sim workflows source get')
      expect(tsconfigInclude(project).some((path) => path.startsWith('.sim/examples'))).toBe(false)
    }
  })

  it('type-checks only the blocks the source uses by default, and every current block through the cache in tsconfig.full.json', async () => {
    serve({
      [SOURCE_PATH]: () =>
        source(
          {
            'workflow.ts': [
              '// @sim-sdk 1',
              "const mail = gmail.sendEmail('Mail', {})",
              "const bot = agent('Bot', { tools: [slack.tool.sendMessage({})] })",
            ].join('\n'),
          },
          ['agent']
        ),
    })

    await get('--dir', outDir)

    const include = tsconfigInclude('tsconfig.json')
    expect(include.slice(0, 3)).toEqual([
      'workflow.ts',
      '.sim/sdk/models.d.ts',
      '.sim/sdk/workspace.d.ts',
    ])
    expect(include).toEqual(
      expect.arrayContaining([
        '.sim/sdk/blocks/agent.d.ts',
        '.sim/sdk/blocks/gmail_v2.d.ts',
        '.sim/sdk/blocks/slack_v2.d.ts',
        '.sim/sdk/blocks/workflow_input.d.ts',
      ])
    )
    expect(include).not.toContain('.sim/sdk/blocks/google_sheets_v2.d.ts')
    expect(include.every((path) => existsSync(join(outDir, path)))).toBe(true)
    const [entry, fullIndex, workspace] = tsconfigInclude('tsconfig.full.json')
    expect([entry, workspace]).toEqual(['workflow.ts', '.sim/sdk/workspace.d.ts'])
    expect(fullIndex.startsWith(join(rootDir, 'config/cache/source-catalog', CATALOG.hash))).toBe(
      true
    )
    expect(readFileSync(fullIndex, 'utf8')).toContain("import './blocks/google_sheets_v2'")
    expect(existsSync(join(dirname(fullIndex), 'blocks/google_sheets_v2.d.ts'))).toBe(true)
  })

  it('lists the builders of the blocks it holds in the builder index, and every builder in the cached one', async () => {
    serve()

    await get('--dir', outDir)

    expect(existsSync(join(outDir, '.sim/sdk/operations'))).toBe(false)
    const local = readFileSync(join(outDir, '.sim/sdk/INDEX.md'), 'utf8')
    expect(local).toContain('- `agent` — Agent → `blocks/agent.d.ts` (`AgentParams`)')
    expect(local).not.toContain('`gmail.sendEmail`')
    const [, fullIndex] = tsconfigInclude('tsconfig.full.json')
    expect(readFileSync(join(dirname(fullIndex), 'INDEX.md'), 'utf8')).toContain(
      '- `gmail.sendEmail` — Gmail: Send Email → `blocks/gmail_v2.d.ts` (`GmailSendEmailParams`)'
    )
  })

  it('revalidates one cached catalog per workspace, whatever the output directory, and reuses it on 304', async () => {
    serve()
    await get('--dir', outDir)
    request.mockReset()
    serve({
      [CATALOG_PATH]: () => {
        throw new SimApiError('Not modified', 304)
      },
    })
    const otherDir = join(rootDir, 'other')

    await get('--dir', otherDir)

    expect(callsTo(CATALOG_PATH)[0][1].headers).toEqual({ 'if-none-match': `"${CATALOG.hash}"` })
    expect(existsSync(join(otherDir, '.sim/sdk/blocks/agent.d.ts'))).toBe(true)
  })

  it('fetches the per-workflow source catalog when the workflow holds a type the workspace no longer offers', async () => {
    const compileCatalog = {
      ...CATALOG,
      blocks: { ...CATALOG.blocks, legacy_block: { ...CATALOG.blocks.note, type: 'legacy_block' } },
    }
    serve({
      [SOURCE_PATH]: () => source(undefined, ['agent', 'legacy_block']),
      [CATALOG_PATH]: () =>
        callsTo(CATALOG_PATH).length === 1 ? { data: CATALOG } : { data: compileCatalog },
    })

    await get('--dir', outDir)

    expect(callsTo(CATALOG_PATH).map((call) => call[1].query)).toEqual([
      undefined,
      { workflowId: WORKFLOW_ID },
    ])
  })

  it('surfaces a 304 when no cached catalog exists rather than writing without types', async () => {
    serve({
      [CATALOG_PATH]: () => {
        throw new SimApiError('Not modified', 304)
      },
    })

    await expect(get('--dir', outDir)).rejects.toThrow('Not modified')
    expect(existsSync(join(outDir, 'workflow.ts'))).toBe(false)
  })

  it('refuses a file path that would escape the output directory, writing nothing', async () => {
    serve({ [SOURCE_PATH]: () => source({ '../escape.js': 'x' }) })

    await expect(get('--dir', outDir)).rejects.toThrow('unsafe file path')
    expect(existsSync(join(rootDir, 'escape.js'))).toBe(false)
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('refuses a workspace source directory, --force included, keeping its base and unapplied edits', async () => {
    const base = JSON.stringify({ version: 1, workspaceId: WORKSPACE_ID, resources: {} })
    mkdirSync(join(outDir, '.sim'), { recursive: true })
    mkdirSync(join(outDir, 'tables'))
    writeFileSync(join(outDir, '.sim/base.json'), base)
    writeFileSync(join(outDir, 'tables/leads.ts'), '// my unapplied edit\n')
    serve()

    for (const flags of [[], ['--force']]) {
      await expect(get('--dir', outDir, ...flags)).rejects.toMatchObject({
        code: 'SOURCE_DIR_KIND_MISMATCH',
        message: expect.stringContaining('is a workspace source directory'),
      })
    }
    expect(readFileSync(join(outDir, '.sim/base.json'), 'utf8')).toBe(base)
    expect(existsSync(join(outDir, 'workflow.ts'))).toBe(false)
    expect(request).not.toHaveBeenCalled()
  })

  it("reports the server's findings on the printed source, such as a secret printed as stored()", async () => {
    const finding = {
      code: 'W_LITERAL_SECRET',
      severity: 'warning',
      message: 'code holds what looks like a literal credential; get prints it as stored()',
    }
    serve({ [SOURCE_PATH]: () => ({ data: { ...source().data, diagnostics: [finding] } }) })

    await get('--dir', outDir)

    const printed = JSON.parse(vi.mocked(console.log).mock.calls.at(-1)?.join(' ') ?? '{}')
    expect(printed.diagnostics).toEqual([expect.objectContaining(finding)])
  })

  it('prints the response unchanged without --dir', async () => {
    request.mockResolvedValue(source())

    await get('--function-code', 'inline')

    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.calls[0][1].query).toMatchObject({ functionCode: 'inline' })
    expect(existsSync(join(outDir, 'workflow.ts'))).toBe(false)
  })

  it('in a workflow folder of a workspace directory, reads and keeps the workspace record of what it wrote', async () => {
    const folder = join(rootDir, 'workflows/w')
    mkdirSync(join(folder, '.sim'), { recursive: true })
    mkdirSync(join(rootDir, '.sim'))
    const before = '// @sim-sdk 1\n// before\n'
    writeFileSync(join(folder, 'workflow.ts'), before)
    writeFileSync(join(folder, '.sim/base.json'), JSON.stringify(source().data.base))
    writeFileSync(
      join(rootDir, '.sim/base.json'),
      JSON.stringify({ version: 1, workspaceId: WORKSPACE_ID, resources: {} })
    )
    writeFileSync(
      join(rootDir, '.sim/written.json'),
      JSON.stringify({ version: 1, files: { 'workflows/w/workflow.ts': digest(before) } })
    )
    serve()

    await get('--dir', folder)

    expect(readFileSync(join(folder, 'workflow.ts'), 'utf8')).toBe('// @sim-sdk 1\n')
    expect(existsSync(join(folder, '.sim/written.json'))).toBe(false)
    const record = JSON.parse(readFileSync(join(rootDir, '.sim/written.json'), 'utf8'))
    expect(record.files['workflows/w/workflow.ts']).toBe(digest('// @sim-sdk 1\n'))
  })
})
