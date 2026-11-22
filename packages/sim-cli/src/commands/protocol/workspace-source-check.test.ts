import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { COOKBOOK_EXAMPLES, WORKSPACE_COOKBOOK } from '@sim/workflow-sdk/codegen'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SimApiError } from '../../http/client'
import { cacheCatalogText } from '../../test/catalog-cache'
import { contextMockFns, mockedProfile } from '../../test/context-mock'
import { attachWorkspaceSourceCheck } from './workspace-source-check'

vi.mock('../../context', async () => (await import('../../test/context-mock')).contextMock)

const WORKSPACE_ID = 'ws_check'
/** A real catalog projected from registry blocks, shared with the SDK's own type checks. */
const FIXTURE_CATALOG = join(__dirname, '../../../../workflow-sdk/test/fixtures/catalog.json')

/** A workflow inserting a row into `contacts`; `table` and `column` vary what it names. */
function insertWorkflow(table = 'contacts', column = 'email'): string {
  return [
    '// @sim-sdk 1',
    "import { table, trigger, workflow } from '@sim/workflow-sdk'",
    "export default workflow('W', {}, () => {",
    "  const start = trigger.start('Start', { inputFormat: { email: 'string' } })",
    `  const save = table.insertRow('Save', { tableId: table('${table}'), data: { ${column}: start.email } })`,
    '  start.to(save)',
    '})',
    '',
  ].join('\n')
}

let dir: string

async function check(...flags: string[]): Promise<void> {
  const source = new Command('source')
  attachWorkspaceSourceCheck(source)
  source.commands.forEach((command) => command.exitOverride())
  await source.parseAsync(['node', 'source', 'check', '--dir', dir, ...flags])
}

function writeFile(path: string, text: string): void {
  mkdirSync(join(dir, path, '..'), { recursive: true })
  writeFileSync(join(dir, path), text)
}

function result(): Record<string, unknown> {
  return JSON.parse(vi.mocked(console.log).mock.calls.at(-1)?.join(' ') ?? '{}')
}

/** Stdout as the one JSON document `--output json` promises. */
function stdoutJson(): Record<string, unknown> {
  const calls = vi.mocked(console.log).mock.calls
  expect(calls).toHaveLength(1)
  return JSON.parse(calls[0].join(' '))
}

/**
 * The findings of the JSON result on stdout as a person reads them on stderr in a display format
 * (`file:line:column severity CODE: message`, then its hint): with `--output json` they are
 * printed only there.
 */
function findingLines(): string {
  const diagnostics = (result().diagnostics ?? []) as Array<Record<string, unknown>>
  return diagnostics
    .map(
      ({ file, line, column, severity, code, message, hint }) =>
        `${file === undefined ? '' : `${file}:${line}:${column} `}${severity} ${code}: ${message}${hint === undefined ? '' : `\n  hint: ${hint}`}`
    )
    .join('\n')
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sim-workspace-check-'))
  writeFile(
    '.sim/base.json',
    JSON.stringify({ version: 1, workspaceId: WORKSPACE_ID, resources: {} })
  )
  writeFile(
    'tables/contacts.ts',
    [
      '// @sim-sdk 1',
      "import { column, defineTable } from '@sim/workflow-sdk/workspace'",
      "export default defineTable({ name: 'contacts', columns: { email: column.string() } })",
      '',
    ].join('\n')
  )
  cacheCatalogText(join(dir, 'config'), WORKSPACE_ID, readFileSync(FIXTURE_CATALOG, 'utf8'))
  vi.stubEnv('SIM_CONFIG_DIR', join(dir, 'config'))
  contextMockFns.mockProfileFrom.mockReturnValue({
    ...mockedProfile(),
    workspaceId: 'ws_other',
    output: 'json',
  })
  contextMockFns.mockRequest.mockReset()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
})

afterEach(() => {
  process.exitCode = undefined
  rmSync(dir, { recursive: true, force: true })
})

describe('sim workspaces source check', () => {
  it('checks every workflow against the directory declarations, without a request', async () => {
    writeFile('workflows/first/workflow.ts', insertWorkflow())
    writeFile('workflows/second/workflow.ts', insertWorkflow())

    await check()

    expect(result()).toMatchObject({ checked: 'compile', errors: 0, warnings: 0, workflows: 2 })
    expect(process.exitCode).toBeUndefined()
    expect(contextMockFns.mockRequest).not.toHaveBeenCalled()
  })

  it('reports each workflow finding under its folder path and exits 1', async () => {
    writeFile('workflows/first/workflow.ts', insertWorkflow())
    writeFile('workflows/second/workflow.ts', insertWorkflow('contact'))
    writeFile('workflows/third/workflow.ts', insertWorkflow('contacts', 'emial'))

    await check()

    expect(result()).toMatchObject({ errors: 2, workflows: 3 })
    expect(findingLines()).toMatch(
      /workflows\/second\/workflow\.ts:5:\d+ error E_MAT_UNKNOWN_RESOURCE: No table "contact"/
    )
    expect(findingLines()).toMatch(
      /workflows\/third\/workflow\.ts:5:\d+ error W_TABLE_UNKNOWN_COLUMN/
    )
    expect(process.exitCode).toBe(1)
  })

  it('checks the columns of a row that also writes a non-string reference', async () => {
    // A number output is stored bare (`"seen": <start.count>`), so the row is not plain JSON.
    writeFile(
      'workflows/first/workflow.ts',
      insertWorkflow('contacts', 'emial')
        .replace(
          "inputFormat: { email: 'string' }",
          "inputFormat: { email: 'string', count: 'number' }"
        )
        .replace('emial: start.email', 'emial: start.email, seen: start.count')
    )

    await check()

    expect(findingLines()).toMatch(/W_TABLE_UNKNOWN_COLUMN: data writes emial/)
    expect(findingLines()).toMatch(/W_TABLE_UNKNOWN_COLUMN: data writes seen/)
    expect(process.exitCode).toBe(1)
  })

  it('puts each finding in the JSON on stdout, under its folder path', async () => {
    writeFile('workflows/second/workflow.ts', insertWorkflow('contact'))

    await check()

    expect(stdoutJson()).toMatchObject({
      errors: 1,
      diagnostics: [
        expect.objectContaining({
          code: 'E_MAT_UNKNOWN_RESOURCE',
          file: 'workflows/second/workflow.ts',
          line: 5,
        }),
      ],
    })
  })

  it('in a fresh clone (no cached catalog), downloads the catalog once and checks', async () => {
    const catalog = readFileSync(FIXTURE_CATALOG, 'utf8')
    rmSync(join(dir, 'config'), { recursive: true })
    writeFile('workflows/first/workflow.ts', insertWorkflow())
    contextMockFns.mockRequest.mockResolvedValue({ data: JSON.parse(catalog) })

    await check()

    expect(result()).toMatchObject({ errors: 0, workflows: 1 })
    expect(contextMockFns.mockRequest).toHaveBeenCalledTimes(1)
    expect(contextMockFns.mockRequest.mock.calls[0][0]).toBe(
      `/api/v2/workspaces/${WORKSPACE_ID}/workflows/source/catalog`
    )
  })

  it('refuses without a cached catalog or credentials, naming the workspace get that caches one', async () => {
    rmSync(join(dir, 'config'), { recursive: true })
    writeFile('workflows/first/workflow.ts', insertWorkflow())
    contextMockFns.mockClientFrom.mockImplementationOnce(() => {
      throw new Error('Not signed in')
    })

    const error = await check().catch((caught: unknown) => caught)

    expect(error).toMatchObject({
      code: 'CATALOG_NOT_CACHED',
      message: expect.stringContaining('sim workspaces source get'),
    })
  })

  it('offline with no cached catalog, refuses naming the get; without a login, keeps exit 13', async () => {
    rmSync(join(dir, 'config'), { recursive: true })
    writeFile('workflows/first/workflow.ts', insertWorkflow())
    contextMockFns.mockRequest.mockRejectedValueOnce(
      new SimApiError('Could not reach https://sim.example: ECONNREFUSED', 0)
    )

    const offline = await check().catch((caught: unknown) => caught)

    expect(offline).toMatchObject({
      code: 'CATALOG_NOT_CACHED',
      message: expect.stringContaining('sim workspaces source get'),
    })

    contextMockFns.mockRequest.mockRejectedValueOnce(
      new SimApiError(
        'Not logged in. Run: sim login --profile default',
        0,
        'AUTH_REQUIRED',
        undefined,
        13
      )
    )
    const loggedOut = await check().catch((caught: unknown) => caught)
    expect(loggedOut).toMatchObject({ code: 'AUTH_REQUIRED', exitCode: 13 })
  })

  it('refuses a directory that holds no workspace source instead of checking nothing', async () => {
    const error = await check('--dir', join(dir, 'typo')).catch((caught: unknown) => caught)

    expect(error).toMatchObject({
      message: expect.stringContaining('holds no workspace source'),
    })
    expect(process.exitCode).toBeUndefined()
  })

  it('refuses a workflow folder, naming the workflow check', async () => {
    writeFile('workflows/first/workflow.ts', insertWorkflow())
    writeFile(
      'workflows/first/.sim/base.json',
      JSON.stringify({ workflowId: 'wf_first', workspaceId: WORKSPACE_ID })
    )

    const error = await check('--dir', join(dir, 'workflows/first')).catch(
      (caught: unknown) => caught
    )

    expect(error).toMatchObject({
      message: expect.stringContaining(
        'is a workflow source directory (workflow wf_first), so a `sim workspaces source` command'
      ),
    })
  })

  it('checks a managed rows file against its table, at each line, as the dry run would refuse it', async () => {
    writeFile(
      'tables/plans.ts',
      [
        '// @sim-sdk 1',
        "import { column, defineTable } from '@sim/workflow-sdk/workspace'",
        'export default defineTable({',
        "  name: 'plans',",
        '  columns: {',
        '    code: column.string({ required: true, unique: true }),',
        '    label: column.string({ required: true, unique: true }),',
        "    tier: column.select({ options: ['free', 'pro'] }),",
        '    seats: column.number(),',
        '  },',
        "  rows: { mode: 'managed', key: 'code' },",
        '})',
        '',
      ].join('\n')
    )
    writeFile(
      'tables/plans.rows.jsonl',
      [
        '{"code":"a","label":"A","tier":"pro","seats":5}',
        '{"code":"b","tier":"free"}',
        '{"code":"c","label":"A"}',
        '{"code":"d","label":"D","seats":"five"}',
        '{"code":"e","label":"E","tier":"platinum"}',
        '{"code":"f",',
        '{"code":"a","label":"G"}',
        '',
      ].join('\n')
    )

    await check()

    const found = (stdoutJson().diagnostics as Array<Record<string, unknown>>).map(
      ({ code, file, line, message }) => ({ code, file, line, message })
    )
    expect(found).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          line: 2,
          message: expect.stringContaining('Missing required field: label'),
        }),
        expect.objectContaining({
          line: 3,
          message: expect.stringContaining('Column "label" must be unique'),
        }),
        expect.objectContaining({
          line: 4,
          message: expect.stringContaining('seats must be number'),
        }),
        expect.objectContaining({
          line: 5,
          message: expect.stringContaining('tier must be one of the defined options'),
        }),
        expect.objectContaining({ line: 6, message: expect.stringContaining('not JSON') }),
        expect.objectContaining({ line: 7, message: expect.stringContaining('share the key') }),
      ])
    )
    expect(found).toHaveLength(6)
    expect(
      found.every(({ code, file }) => code === 'E_TABLE_ROWS' && file === 'tables/plans.rows.jsonl')
    ).toBe(true)
    expect(process.exitCode).toBe(1)
  })

  it('a rows file with more bad lines than one file lists exits 1, as source errors, not 7 as a size limit', async () => {
    writeFile(
      'tables/plans.ts',
      [
        '// @sim-sdk 1',
        "import { column, defineTable } from '@sim/workflow-sdk/workspace'",
        'export default defineTable({',
        "  name: 'plans',",
        '  columns: { code: column.string({ required: true, unique: true }) },',
        "  rows: { mode: 'managed', key: 'code' },",
        '})',
        '',
      ].join('\n')
    )
    writeFile('tables/plans.rows.jsonl', `${Array.from({ length: 150 }, () => '{').join('\n')}\n`)

    await check()

    const found = stdoutJson().diagnostics as Array<{ code: string; severity: string }>
    expect(found.at(-1)).toMatchObject({ code: 'I_FINDINGS_TRUNCATED', severity: 'info' })
    expect(found.filter((finding) => finding.severity === 'error')).toHaveLength(100)
    expect(process.exitCode).toBe(1)
  })

  it('lists at most the 1000 findings a server answer would, ending in one I_FINDINGS_TRUNCATED, and counts every error', async () => {
    const tables = 11
    for (let index = 0; index < tables; index++) {
      writeFile(
        `tables/plans${index}.ts`,
        [
          '// @sim-sdk 1',
          "import { column, defineTable } from '@sim/workflow-sdk/workspace'",
          'export default defineTable({',
          `  name: 'plans${index}',`,
          '  columns: { code: column.string({ required: true, unique: true }) },',
          "  rows: { mode: 'managed', key: 'code' },",
          '})',
          '',
        ].join('\n')
      )
      writeFile(
        `tables/plans${index}.rows.jsonl`,
        `${Array.from({ length: 150 }, () => '{').join('\n')}\n`
      )
    }

    await check()

    const answer = stdoutJson()
    const found = answer.diagnostics as Array<{ code: string; severity: string }>
    expect(found).toHaveLength(1_001)
    expect(found.filter((finding) => finding.code === 'I_FINDINGS_TRUNCATED')).toHaveLength(1)
    expect(found.at(-1)).toMatchObject({ code: 'I_FINDINGS_TRUNCATED', severity: 'info' })
    expect(answer.errors).toBe(tables * 100)
    expect(process.exitCode).toBe(1)
  })

  it('accepts seed rows the columns hold, coercing a numeric string as the write does', async () => {
    writeFile(
      'tables/seeds.ts',
      [
        '// @sim-sdk 1',
        "import { column, defineTable } from '@sim/workflow-sdk/workspace'",
        "export default defineTable({ name: 'seeds', columns: { n: column.number({ required: true }) }, rows: { mode: 'seed' } })",
        '',
      ].join('\n')
    )
    writeFile('tables/seeds.rows.jsonl', '{"n":"12"}\n{"n":3}\n')

    await check()

    expect(stdoutJson()).toMatchObject({ errors: 0 })
  })

  /** A workflow file whose body is `lines`, importing every builder the tests use. */
  function workflowFile(...lines: string[]): string {
    return [
      '// @sim-sdk 1',
      "import { agent, childWorkflow, condition, env, fn, js, response, runWorkflow, skill, t, trigger, workflow } from '@sim/workflow-sdk'",
      "export default workflow('W', {}, () => {",
      ...lines.map((line) => `  ${line}`),
      '})',
      '',
    ].join('\n')
  }

  it('checks skill keys against skills/, with a did-you-mean and the code point of a look-alike letter', async () => {
    writeFile('skills/triage.md', '---\nname: triage\ndescription: Triage\n---\nBody\n')
    writeFile(
      'workflows/first/workflow.ts',
      workflowFile(
        "const start = trigger.start('Start', { inputFormat: { q: 'string' } })",
        "const a = agent('A', { model: 'gpt-4o', messages: [{ role: 'user', content: start.q }], skills: [skill('triagee')] })",
        "const b = agent('B', { model: 'gpt-4o', messages: [{ role: 'user', content: start.q }], skills: [skill('tri\u0430ge')] })",
        'start.to(a)',
        'a.to(b)'
      )
    )

    await check()

    const found = (stdoutJson().diagnostics as Array<Record<string, string>>).filter(
      (finding) => finding.code === 'E_MAT_UNKNOWN_RESOURCE'
    )
    expect(found).toEqual([
      expect.objectContaining({
        code: 'E_MAT_UNKNOWN_RESOURCE',
        message: 'No skill "triagee" is declared in this workspace directory.',
        hint: 'Did you mean triage? Keys: triage.',
      }),
      expect.objectContaining({
        code: 'E_MAT_UNKNOWN_RESOURCE',
        message: expect.stringContaining('holds U+0430, a Cyrillic letter'),
        hint: 'Did you mean triage? Keys: triage.',
      }),
    ])
  })

  it('checks a child call against the child workflow: its inputs, and that it has a Start trigger', async () => {
    writeFile(
      'workflows/child/workflow.ts',
      workflowFile("const start = trigger.start('Start', { inputFormat: { question: 'string' } })")
    )
    writeFile(
      'workflows/hook/workflow.ts',
      workflowFile("const hook = trigger.webhook('Hook', { inputFormat: { question: 'string' } })")
    )
    writeFile(
      'workflows/parent/workflow.ts',
      workflowFile(
        "const start = trigger.start('Start', { inputFormat: { q: 'string' } })",
        "const ok = runWorkflow('Ok', { workflowId: childWorkflow('child'), inputMapping: { question: start.q } })",
        "const typo = runWorkflow('Typo', { workflowId: childWorkflow('child'), inputMapping: { qestion: start.q } })",
        "const hooked = runWorkflow('Hooked', { workflowId: childWorkflow('hook'), inputMapping: { question: start.q } })",
        'start.to(ok)',
        'ok.to(typo)',
        'typo.to(hooked)'
      )
    )

    await check()

    const found = stdoutJson().diagnostics as Array<Record<string, unknown>>
    expect(found).toEqual([
      expect.objectContaining({
        code: 'W_CHILD_INPUT_UNKNOWN',
        severity: 'error',
        line: 6,
        hint: expect.stringContaining('Did you mean question?'),
      }),
      expect.objectContaining({ code: 'W_CHILD_NO_START', severity: 'warning', line: 7 }),
    ])
  })

  it("warns on a child call's result.<key> when the child responds, naming result.data.<key>", async () => {
    writeFile(
      'workflows/responder/workflow.ts',
      workflowFile(
        "const start = trigger.start('Start', { inputFormat: { q: 'string' } })",
        "const reply = response('Reply', { body: { mobile: start.q } })",
        'start.to(reply)'
      )
    )
    writeFile(
      'workflows/silent/workflow.ts',
      workflowFile(
        "const start = trigger.start('Start', { inputFormat: { q: 'string' } })",
        "const echo = fn('Echo', { code: js`return { mobile: ${start.q} }` })",
        'start.to(echo)'
      )
    )
    writeFile(
      'workflows/parent/workflow.ts',
      workflowFile(
        "const start = trigger.start('Start', { inputFormat: { q: 'string' } })",
        "const call = runWorkflow('Call', { workflowId: childWorkflow('responder'), inputMapping: { q: start.q } })",
        "const other = runWorkflow('Other', { workflowId: childWorkflow('silent'), inputMapping: { q: start.q } })",
        "const use = fn('Use', { code: js`return [${call.result.mobile}, ${call.result.data.mobile}, ${other.result.mobile}]` })",
        "const reply = response('Reply', { body: { mobile: t`${call.result.mobile}`, ok: t`${call.result.status}` } })",
        'start.to(call)',
        'call.to(other)',
        'other.to(use)',
        'use.to(reply)'
      )
    )

    await check()

    const found = (stdoutJson().diagnostics as Array<Record<string, unknown>>).filter(
      (finding) => finding.code === 'W_CHILD_RESULT_PATH'
    )
    expect(found).toEqual([
      expect.objectContaining({
        code: 'W_CHILD_RESULT_PATH',
        file: 'workflows/parent/workflow.ts',
        line: 7,
        message: expect.stringContaining(
          '<call.result.mobile> reads mobile from the result of workflow "responder"'
        ),
        hint: expect.stringContaining('Did you mean <call.result.data.mobile>?'),
      }),
      expect.objectContaining({ code: 'W_CHILD_RESULT_PATH', line: 8 }),
    ])
  })

  it("judges a child's result.<key> only when every run of the child ends at a Response block", async () => {
    // Gate.else ends the run at Echo, which returns { mobile }: result.mobile reads it then.
    writeFile(
      'workflows/branchy/workflow.ts',
      workflowFile(
        "const start = trigger.start('Start', { inputFormat: { q: 'string' } })",
        "const gate = condition('Gate', { yes: js`${start.q} === 'y'`, else: true })",
        "const reply = response('Reply', { body: { mobile: start.q } })",
        "const echo = fn('Echo', { code: js`return { mobile: ${start.q} }` })",
        'start.to(gate)',
        'gate.yes.to(reply)',
        'gate.else.to(echo)'
      )
    )
    writeFile(
      'workflows/covered/workflow.ts',
      workflowFile(
        "const start = trigger.start('Start', { inputFormat: { q: 'string' } })",
        "const gate = condition('Gate', { yes: js`${start.q} === 'y'`, else: true })",
        "const reply = response('Reply', { body: { mobile: start.q } })",
        "const other = response('Other', { body: { mobile: 'none' } })",
        'start.to(gate)',
        'gate.yes.to(reply)',
        'gate.else.to(other)'
      )
    )
    writeFile(
      'workflows/proto/workflow.ts',
      workflowFile(
        "const start = trigger.start('Start', { inputFormat: { q: 'string' } })",
        "const reply = response('__proto__', { body: { mobile: start.q } })",
        'start.to(reply)'
      )
    )
    writeFile(
      'workflows/parent/workflow.ts',
      workflowFile(
        "const start = trigger.start('Start', { inputFormat: { q: 'string' } })",
        "const maybe = runWorkflow('Maybe', { workflowId: childWorkflow('branchy'), inputMapping: { q: start.q } })",
        "const always = runWorkflow('Always', { workflowId: childWorkflow('covered'), inputMapping: { q: start.q } })",
        "const named = runWorkflow('Named', { workflowId: childWorkflow('proto'), inputMapping: { q: start.q } })",
        "const use = fn('Use', { code: js`return [${maybe.result.mobile}, ${always.result.mobile}, ${named.result.mobile}]` })",
        'start.to(maybe)',
        'maybe.to(always)',
        'always.to(named)',
        'named.to(use)'
      )
    )

    await check()

    const found = (stdoutJson().diagnostics as Array<Record<string, unknown>>).filter(
      (finding) => finding.code === 'W_CHILD_RESULT_PATH'
    )
    expect(found).toEqual([
      expect.objectContaining({
        message: expect.stringContaining('<always.result.mobile> reads mobile'),
      }),
      expect.objectContaining({
        message: expect.stringContaining('<named.result.mobile> reads mobile'),
      }),
    ])
  })

  it("checks the cookbook example's table writes clean against the cookbook workspace's tables", async () => {
    for (const [path, text] of Object.entries(WORKSPACE_COOKBOOK)) writeFile(path, text)
    writeFile('workflows/cookbook/workflow.ts', COOKBOOK_EXAMPLES['cookbook.ts'])

    await check()

    const tableFindings = (stdoutJson().diagnostics as Array<Record<string, unknown>>).filter(
      (finding) =>
        finding.file === 'workflows/cookbook/workflow.ts' &&
        ['W_TABLE_UNKNOWN_COLUMN', 'W_UNKNOWN_OPTION'].includes(String(finding.code))
    )
    expect(tableFindings).toEqual([])
  })

  it('points an unknown env name at secrets.ts', async () => {
    writeFile(
      'secrets.ts',
      "// @sim-sdk 1\nimport { defineSecrets } from '@sim/workflow-sdk/workspace'\nexport default defineSecrets({ OPENAI_API_KEY: {} })\n"
    )
    writeFile(
      'workflows/first/workflow.ts',
      workflowFile(
        "const start = trigger.start('Start', { inputFormat: { q: 'string' } })",
        "const a = agent('A', { model: 'gpt-4o', apiKey: env.OPENAI_API_KEX, messages: [{ role: 'user', content: start.q }] })",
        'start.to(a)'
      )
    )

    await check()

    expect(stdoutJson().diagnostics).toEqual([
      expect.objectContaining({
        code: 'W_ENV_UNKNOWN',
        hint: 'Did you mean OPENAI_API_KEY? Otherwise declare OPENAI_API_KEX in secrets.ts and set its value with `sim secrets set OPENAI_API_KEX --scope workspace`.',
      }),
    ])
  })

  it('drops "kept as written" from a warning it raises to an error', async () => {
    writeFile(
      'tables/contacts.ts',
      [
        '// @sim-sdk 1',
        "import { column, defineTable } from '@sim/workflow-sdk/workspace'",
        "export default defineTable({ name: 'contacts', columns: { email: column.string(), plan: column.select({ options: ['free'] }) } })",
        '',
      ].join('\n')
    )
    writeFile(
      'workflows/first/workflow.ts',
      [
        '// @sim-sdk 1',
        "import { table, trigger, workflow } from '@sim/workflow-sdk'",
        "export default workflow('W', {}, () => {",
        "  const start = trigger.start('Start', { inputFormat: { email: 'string' } })",
        "  const save = table.insertRow('Save', { tableId: table('contacts'), data: { email: start.email, plan: 'gold' } })",
        '  start.to(save)',
        '})',
        '',
      ].join('\n')
    )

    await check()

    expect(stdoutJson().diagnostics).toEqual([
      expect.objectContaining({
        code: 'W_UNKNOWN_OPTION',
        severity: 'error',
        message: 'plan of table "contacts" has no option gold.',
      }),
    ])
  })

  it('regenerates workspace.d.ts from the kept manifest and the declarations, typing child inputs', async () => {
    writeFile(
      '.sim/sdk/workspace.manifest.json',
      JSON.stringify({ skills: ['stored-skill'], env: ['STORED'] })
    )
    writeFile('.sim/sdk/workspace.d.ts', '// stale\n')
    writeFile('skills/triage.md', '---\nname: triage\ndescription: Triage\n---\nBody\n')
    writeFile(
      'workflows/child/workflow.ts',
      workflowFile(
        "const start = trigger.start('Start', { inputFormat: { question: 'string', count: 'number' } })"
      )
    )

    await check()

    const types = readFileSync(join(dir, '.sim/sdk/workspace.d.ts'), 'utf8')
    expect(types).toContain(`'child': { inputs: { count: number; question: string } }`)
    expect(types).toContain(`'contacts': RowOf<typeof import('../../tables/contacts').default>`)
    expect(types).toMatch(/'stored-skill': true[\s\S]*'triage': true/)
    expect(types).toContain('STORED: true')
  })
})
