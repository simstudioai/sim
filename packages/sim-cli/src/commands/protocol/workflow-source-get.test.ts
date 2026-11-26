import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { escapeRegExp } from '@sim/utils/string'
import { COOKBOOK_EXAMPLES, WORKSPACE_COOKBOOK } from '@sim/workflow-sdk/codegen'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runEmbeddedCli } from '../../embed'
import { SimApiError } from '../../http/client'
import { buildProgram } from '../../program'
import { buildGeneratedCommands } from '../../runtime/build'
import { contextMockFns, contextMockState, mockedProfile } from '../../test/context-mock'
import { provideTypescript } from '../../test/typescript'
import { digest } from './source-dir'
import {
  AGENTS_POINTER_MARKER,
  agentsPointer,
  PATTERNS_HEADING,
  PRIMER_MAX_BYTES,
  sourcePrimer,
} from './source-primer'
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
        version: 1,
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
    customTools: [{ key: 'lookup-order', id: 'tool-1', name: 'Lookup order' }],
    mcpServers: [],
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
  provideTypescript(join(rootDir, 'config'))
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  rmSync(rootDir, { recursive: true, force: true })
})

describe('sim workflows source get <name>', () => {
  const LIST_PATH = '/api/v2/workflows'
  const OTHER_ID = '00000000-0000-4000-8000-00000000000c'
  const listed =
    (...workflows: Array<{ id: string; name: string; folderPath?: string }>) =>
    () => ({
      data: workflows.map((workflow) => ({ folderPath: '', ...workflow })),
      nextCursor: null,
    })

  async function getNamed(name: string): Promise<unknown> {
    return program()
      .parseAsync(['node', 'sim', 'workflows', 'source', 'get', name, '--dir', outDir])
      .then(
        () => null,
        (error: unknown) => error
      )
  }

  it('gets the one workflow whose name matches exactly, not one that only contains it', async () => {
    serve({
      [LIST_PATH]: listed(
        { id: OTHER_ID, name: 'Lead Scorer v2' },
        { id: WORKFLOW_ID, name: 'Lead Scorer' }
      ),
    })

    expect(await getNamed('Lead Scorer')).toBeNull()

    expect(callsTo(LIST_PATH)[0][1].query).toMatchObject({ search: 'Lead Scorer' })
    expect(callsTo(SOURCE_PATH)).toHaveLength(1)
    expect(JSON.parse(readFileSync(join(outDir, '.sim/base.json'), 'utf8')).workflowId).toBe(
      WORKFLOW_ID
    )
  })

  it('reads every page of substring hits before deciding, so an exact match after the first is found', async () => {
    const hits = Array.from({ length: 100 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, '1')}`,
      name: `Lead Scorer ${index}`,
      folderPath: '',
    }))
    serve({
      [LIST_PATH]: () => {
        const cursor = callsTo(LIST_PATH).at(-1)?.[1].query?.cursor
        return cursor
          ? { data: [{ id: WORKFLOW_ID, name: 'Lead Scorer', folderPath: '' }], nextCursor: null }
          : { data: hits, nextCursor: 'page-2' }
      },
    })

    expect(await getNamed('Lead Scorer')).toBeNull()

    expect(callsTo(LIST_PATH)).toHaveLength(2)
    expect(JSON.parse(readFileSync(join(outDir, '.sim/base.json'), 'utf8')).workflowId).toBe(
      WORKFLOW_ID
    )
  })

  it("looks a name up in the workspace the directory was read from, not the profile's", async () => {
    mkdirSync(join(outDir, '.sim'), { recursive: true })
    writeFileSync(
      join(outDir, '.sim/base.json'),
      JSON.stringify({
        version: 1,
        workflowId: WORKFLOW_ID,
        workspaceId: WORKSPACE_ID,
        fingerprint: 'sf1:a',
        catalogHash: 'h',
      })
    )
    serve({ [LIST_PATH]: listed({ id: WORKFLOW_ID, name: 'Lead Scorer' }) })

    expect(await getNamed('Lead Scorer')).toBeNull()

    expect(callsTo(LIST_PATH)[0][1].query).toMatchObject({ workspaceId: WORKSPACE_ID })
  })

  it.each([
    [
      'several workflows hold the name',
      [
        { id: WORKFLOW_ID, name: 'Lead Scorer', folderPath: 'sales' },
        { id: OTHER_ID, name: 'Lead Scorer', folderPath: 'ops' },
      ],
      'WORKFLOW_NAME_AMBIGUOUS',
    ],
    ['none holds it exactly', [{ id: OTHER_ID, name: 'Lead Scorer v2' }], 'WORKFLOW_NOT_FOUND'],
  ])(
    'refuses when %s, naming each candidate with its id, and reads no source',
    async (_case, workflows, code) => {
      serve({ [LIST_PATH]: listed(...workflows) })

      const error = await getNamed('Lead Scorer')

      expect(error).toMatchObject({ code })
      for (const { id } of workflows) expect(String((error as Error).message)).toContain(id)
      expect(callsTo(SOURCE_PATH)).toHaveLength(0)
      expect(existsSync(join(outDir, '.sim/base.json'))).toBe(false)
    }
  )
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

  it('writes the primer atop the guide with a snippet for each builder the source calls and no other, without printing it', async () => {
    serve({
      [SOURCE_PATH]: () =>
        source({ 'workflow.ts': "// @sim-sdk 1\nconst mail = gmail.sendEmail('Mail', {})\n" }),
    })

    await get('--dir', outDir)

    const printed = JSON.parse(vi.mocked(console.log).mock.calls.at(-1)?.join(' ') ?? '{}')
    expect(printed).not.toHaveProperty('primer')
    expect(printed.guide).toBe('.sim/AGENTS.md')
    expect(printed.editLoop).toEqual([
      expect.stringMatching(
        /^sim workflows source check --dir (\S+) && sim workflows source apply --dir \1 --yes$/
      ),
    ])
    const agents = readFileSync(join(outDir, '.sim/AGENTS.md'), 'utf8')
    expect(agents).toContain('- `gmail.sendEmail` (Gmail: Send Email)')
    expect(agents).not.toContain('`slack.sendMessage`')
  })

  it('names the tables the workflow uses and the output paths its runs fail on, which the read does not', async () => {
    const workflow = [
      '// @sim-sdk 1',
      "import { codeFile, fn, table, trigger, workflow } from '@sim/workflow-sdk'",
      '',
      "export default workflow('Invoices', {}, () => {",
      "  const start = trigger.start('Start', {})",
      "  const lookup = table.queryRows('Lookup Customer', { tableId: table('customers') })",
      "  const discount = fn('Apply Discount', { code: codeFile('./functions/apply-discount.js') })",
      '  start.to(lookup)',
      '  lookup.to(discount)',
      '})',
      '',
    ].join('\n')
    const read = {
      code: 'W_UNRESOLVED_REF',
      severity: 'warning',
      message: '<nosuch.x> names no block.',
      blockKey: 'applydiscount',
    }
    serve({
      [SOURCE_PATH]: () => {
        const answer = source(
          {
            'workflow.ts': workflow,
            'functions/apply-discount.js':
              'const customer = $ref.lookupcustomer.row\nreturn $ref.nosuch.x\n',
          },
          ['function', 'start_trigger', 'table_v2']
        )
        return { data: { ...answer.data, diagnostics: [read] } }
      },
    })

    await get('--dir', outDir)

    const printed = JSON.parse(vi.mocked(console.log).mock.calls.at(-1)?.join(' ') ?? '{}')
    expect(printed.tables).toEqual(['customers'])
    expect(printed.diagnostics).toEqual([
      expect.objectContaining({ code: 'W_UNRESOLVED_REF', message: read.message }),
      expect.objectContaining({
        code: 'W_UNKNOWN_OUTPUT_PATH',
        file: 'functions/apply-discount.js',
        line: 1,
        hint: expect.stringContaining('rows'),
      }),
    ])
  })

  it('says how many output paths no block produces the warning cap left out', async () => {
    const workflow = [
      '// @sim-sdk 1',
      "import { codeFile, fn, table, trigger, workflow } from '@sim/workflow-sdk'",
      '',
      "export default workflow('Invoices', {}, () => {",
      "  const start = trigger.start('Start', {})",
      "  const lookup = table.queryRows('Lookup Customer', { tableId: table('customers') })",
      "  const discount = fn('Apply Discount', { code: codeFile('./functions/apply-discount.js') })",
      '  start.to(lookup)',
      '  lookup.to(discount)',
      '})',
      '',
    ].join('\n')
    const reads = Array.from({ length: 22 }, (_, index) => `$ref.lookupcustomer.row${index}`)
    serve({
      [SOURCE_PATH]: () =>
        source(
          {
            'workflow.ts': workflow,
            'functions/apply-discount.js': `return [${reads.join(', ')}]\n`,
          },
          ['function', 'start_trigger', 'table_v2']
        ),
    })

    await get('--dir', outDir)

    const printed = JSON.parse(vi.mocked(console.log).mock.calls.at(-1)?.join(' ') ?? '{}')
    const codes = printed.diagnostics.map((finding: { code: string }) => finding.code)
    expect(codes.filter((code: string) => code === 'W_UNKNOWN_OUTPUT_PATH')).toHaveLength(20)
    expect(printed.diagnostics.at(-1)).toEqual(
      expect.objectContaining({
        code: 'I_FINDINGS_TRUNCATED',
        message: expect.stringContaining('2 more'),
      })
    )
  })

  it('writes a root AGENTS.md pointing at the guide, and never replaces one it did not write', async () => {
    serve({ [SOURCE_PATH]: () => source() })

    await get('--dir', outDir)

    const pointer = readFileSync(join(outDir, 'AGENTS.md'), 'utf8')
    expect(pointer).toContain('.sim/AGENTS.md')
    expect(pointer.startsWith(AGENTS_POINTER_MARKER)).toBe(true)

    writeFileSync(join(outDir, 'AGENTS.md'), '# My own rules\n')
    await get('--dir', outDir, '--force')

    expect(readFileSync(join(outDir, 'AGENTS.md'), 'utf8')).toBe('# My own rules\n')
  })

  it("leaves a root AGENTS.md that links to the user's own guide untouched, and still refreshes", async () => {
    serve({ [SOURCE_PATH]: () => source() })
    await get('--dir', outDir)
    const guide = join(outDir, '..', 'my-guide.md')
    writeFileSync(guide, '# Mine\n')
    rmSync(join(outDir, 'AGENTS.md'))
    symlinkSync(guide, join(outDir, 'AGENTS.md'))

    await get('--dir', outDir, '--force')

    expect(readFileSync(guide, 'utf8')).toBe('# Mine\n')
    expect(existsSync(join(outDir, '.sim/AGENTS.md'))).toBe(true)
  })

  /** Each primer there is: the workspace directory has the `cli` one alone. */
  const PRIMERS = [
    ['workflow', 'cli'],
    ['workflow', 'chat'],
    ['workspace', 'cli'],
  ] as const

  it.each(PRIMERS)(
    'names in the %s %s primer only commands and flags this CLI has',
    (kind, surface) => {
      const program = buildProgram()
      const roots = new Set(program.commands.map((command) => command.name()))
      // A `sim_cli` command is named without `sim`, as that tool takes it.
      const named = [
        ...`${sourcePrimer(kind, surface)}${agentsPointer(kind, surface)}`.matchAll(/`([^`]+)`/g),
      ]
        .flatMap((match) => match[1].split(' && '))
        .map((line) => line.replace(/^sim /, ''))
        .filter((line) => roots.has(line.split(' ')[0]) && line.includes(' '))
      expect(named.length).toBeGreaterThan(0)
      for (const line of named) {
        let command: Command = program
        for (const word of line.split(/\s+/)) {
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

  it('keeps every primer without snippets within its byte budget', () => {
    for (const [kind, surface] of PRIMERS) {
      expect(
        Buffer.byteLength(sourcePrimer(kind, surface)),
        `${kind} ${surface}`
      ).toBeLessThanOrEqual(PRIMER_MAX_BYTES)
    }
  })

  it('teaches the chat no command its workbench or Sim refuses it, and the test run through sim_cli', () => {
    const chat = `${sourcePrimer('workflow', 'chat')}${agentsPointer('workflow', 'chat')}`
    expect(chat).not.toMatch(/workspaces source/)
    expect(chat).not.toMatch(/ --run(?![\w-])/)
    expect(chat).not.toMatch(/&& sim workflows run\b/)
    expect(chat).toMatch(/sim_cli[^\n]*`workflows run <workflowId> --dry\b/)
    expect(chat).toContain(
      '`workflows deploy <workflowId> --expected-draft-fingerprint <fingerprint>`'
    )
    expect(sourcePrimer('workflow', 'cli')).toContain("--run '{…}' --deploy")
  })

  it.each(PRIMERS)(
    'quotes in the %s %s primer patterns only code the type-checked examples hold',
    (kind, surface) => {
      const examples = [
        ...Object.values(COOKBOOK_EXAMPLES),
        ...Object.values(WORKSPACE_COOKBOOK),
      ].join('\n')
      const lines = sourcePrimer(kind, surface).split('\n')
      const start = lines.findIndex((line) => line.startsWith(PATTERNS_HEADING))
      const end = lines.findIndex((line, index) => index > start && !line.startsWith('  - '))
      const spans = lines
        .slice(start + 1, end)
        .flatMap((line) => [...line.matchAll(/`([^`]+)`/g)].map((match) => match[1]))
      expect(spans.length).toBeGreaterThan(20)
      const missing = spans.filter(
        (span) => !new RegExp(escapeRegExp(span).replace(/<[^>]+>/g, '.+?')).test(examples)
      )
      expect(missing).toEqual([])
    }
  )

  it('writes the chat primer and pointer inside Mothership, and the coding-agent ones elsewhere', async () => {
    const guides = () =>
      ['.sim/AGENTS.md', 'AGENTS.md'].map((file) => readFileSync(join(outDir, file), 'utf8'))
    serve()
    await get('--dir', outDir)
    for (const guide of guides()) {
      expect(guide).toContain("--yes --run '{…}' --deploy")
      expect(guide).not.toContain('sim_cli')
    }

    vi.stubEnv('SIM_CLI_HOST', 'mothership')
    await get('--dir', outDir, '--force')

    for (const guide of guides()) {
      expect(guide).not.toMatch(/ --run(?![\w-])/)
      expect(guide).toContain('with sim_cli')
    }
  })

  it('gives the chat loop in the source help inside Mothership and to an embedded run', async () => {
    const render = () => {
      const source = buildProgram()
        .commands.find((command) => command.name() === 'workflows')
        ?.commands.find((command) => command.name() === 'source')
      let text = ''
      source?.configureOutput({ writeOut: (chunk) => (text += chunk) })
      source?.outputHelp()
      return text
    }
    expect(render()).toContain("--yes --run '{…}' --deploy")
    expect(render()).toContain('sim workspaces source get')

    const embedded = (host?: string) =>
      runEmbeddedCli(
        ['workflows', 'source', '--help'],
        { endpoint: 'https://sim.test', apiKey: 'key' },
        { host }
      )
    expect((await embedded()).stdout).toContain("--yes --run '{…}' --deploy")
    const mothership = (await embedded('mothership')).stdout
    vi.stubEnv('SIM_CLI_HOST', 'mothership')
    for (const chat of [mothership, render()]) {
      expect(chat).not.toMatch(/ --run(?![\w-])|workspaces source/)
      expect(chat).toContain("workflows run <workflowId> --dry --input '{…}' --dir ./wf")
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

  it('type-checks the directory in the check, with the blocks the edit added', async () => {
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
    writeFileSync(
      join(outDir, 'workflow.ts'),
      workflow
        .replace('{ trigger, workflow }', '{ gmail, trigger, workflow }')
        .replace(
          "  const start = trigger.start('Start', {})\n",
          "  const start = trigger.start('Start', {})\n  const mail = gmail.sendEmail('Mail', {\n    to: 'a@b.c',\n    subject: 's',\n    body: start.missing,\n  })\n  start.to(mail)\n"
        )
    )
    contextMockFns.mockProfileFrom.mockReturnValue({
      ...mockedProfile(),
      workspaceId: WORKSPACE_ID,
      output: 'json',
    })
    const check = new Command('source')
    attachWorkflowSourceCheck(check)
    check.commands.forEach((command) => command.exitOverride())
    await check.parseAsync(['node', 'source', 'check', '--dir', outDir])

    expect(process.exitCode).toBe(1)
    process.exitCode = undefined
    const printed = JSON.parse(vi.mocked(console.log).mock.calls.at(-1)?.join(' ') ?? '{}')
    expect(printed.checked).toEqual(['compile', 'types'])
    expect(
      (printed.diagnostics as Array<{ code: string }>).filter(({ code }) => code === 'E_TYPE')
    ).toEqual([
      expect.objectContaining({
        file: 'workflow.ts',
        line: 9,
        message: expect.stringMatching(/^TS2339: Property 'missing' does not exist/),
      }),
    ])
  })

  it('names the refresh when a row write names a column the table types the last get wrote lack', async () => {
    const workflow = [
      '// @sim-sdk 1',
      "import { table, trigger, workflow } from '@sim/workflow-sdk'",
      '',
      "export default workflow('W', {}, () => {",
      "  const start = trigger.start('Start', {})",
      "  const save = table.insertRow('Save', { tableId: table('tickets'), data: { subject: 's', category: 'c' } })",
      '  start.to(save)',
      '})',
      '',
    ].join('\n')
    serve({
      [SOURCE_PATH]: () => source({ 'workflow.ts': workflow }, ['table_v2']),
      [MANIFEST_PATH]: () => ({
        data: {
          ...MANIFEST.data,
          tables: [
            {
              key: 'tickets',
              id: 'tbl-1',
              name: 'tickets',
              columns: [
                { name: 'subject', type: 'string' },
                { name: 'body', type: 'string' },
              ],
            },
          ],
        },
      }),
    })
    await get('--dir', outDir)
    writeFileSync(join(outDir, 'workflow.ts'), `${workflow}\n`)
    contextMockFns.mockProfileFrom.mockReturnValue({
      ...mockedProfile(),
      workspaceId: WORKSPACE_ID,
      output: 'json',
    })
    const check = new Command('source')
    attachWorkflowSourceCheck(check)
    check.commands.forEach((command) => command.exitOverride())
    await check.parseAsync(['node', 'source', 'check', '--dir', outDir])

    expect(process.exitCode).toBe(1)
    process.exitCode = undefined
    const printed = JSON.parse(vi.mocked(console.log).mock.calls.at(-1)?.join(' ') ?? '{}')
    expect(
      (printed.diagnostics as Array<{ code: string }>).filter(({ code }) => code === 'E_TYPE')
    ).toEqual([
      expect.objectContaining({
        message: expect.stringMatching(/^TS2353: .*'category' does not exist/),
        hint: expect.stringContaining(`sim workflows source status --dir ${outDir}`),
      }),
    ])
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
