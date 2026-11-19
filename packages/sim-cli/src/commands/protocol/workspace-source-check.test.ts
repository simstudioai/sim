import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { contextMockFns } from '../../test/context-mock'
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

function stderr(): string {
  return vi
    .mocked(console.error)
    .mock.calls.map((call) => call.join(' '))
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
  writeFile(
    `config/cache/source-catalog/${WORKSPACE_ID}.json`,
    readFileSync(FIXTURE_CATALOG, 'utf8')
  )
  vi.stubEnv('SIM_CONFIG_DIR', join(dir, 'config'))
  contextMockFns.mockProfileFrom.mockReturnValue({ workspaceId: 'ws_other', output: 'json' })
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
    expect(stderr()).toMatch(
      /workflows\/second\/workflow\.ts:5:\d+ error E_MAT_UNKNOWN_RESOURCE: No table "contact"/
    )
    expect(stderr()).toMatch(/workflows\/third\/workflow\.ts:5:\d+ error W_TABLE_UNKNOWN_COLUMN/)
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
    const catalog = readFileSync(
      join(dir, `config/cache/source-catalog/${WORKSPACE_ID}.json`),
      'utf8'
    )
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
        'is a workflow source directory: use `sim workflows source`'
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
})
