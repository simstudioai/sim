import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SimApiError } from '../../http/client'
import { contextMockFns } from '../../test/context-mock'
import { attachWorkflowSourceCheck } from './workflow-source-check'

vi.mock('../../context', async () => (await import('../../test/context-mock')).contextMock)

const WORKSPACE_ID = 'ws_check'
/** A real catalog projected from registry blocks, shared with the SDK's own type checks. */
const FIXTURE_CATALOG = join(__dirname, '../../../../workflow-sdk/test/fixtures/catalog.json')

const CLEAN = `// @sim-sdk 1
import { response, trigger, workflow } from '@sim/workflow-sdk'

export default workflow('W', {}, () => {
  const start = trigger.start('Start', { inputFormat: { message: 'string' } })
  const done = response('Done', { body: { received: start.message } })
  start.to(done)
})
`

let dir: string

async function check(): Promise<void> {
  const source = new Command('source')
  attachWorkflowSourceCheck(source)
  source.commands.forEach((command) => command.exitOverride())
  await source.parseAsync(['node', 'source', 'check', '--dir', dir])
}

function cacheCatalog(): void {
  mkdirSync(join(dir, 'config/cache/source-catalog'), { recursive: true })
  writeFileSync(
    join(dir, `config/cache/source-catalog/${WORKSPACE_ID}.json`),
    readFileSync(FIXTURE_CATALOG, 'utf8')
  )
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

/** A workspace directory declaring a secret, a credential and a table, with `dir` as its root. */
function writeWorkspace(): void {
  writeFileSync(
    join(dir, '.sim/base.json'),
    JSON.stringify({ version: 1, workspaceId: WORKSPACE_ID, resources: {} })
  )
  writeFileSync(
    join(dir, 'secrets.ts'),
    [
      '// @sim-sdk 1',
      "import { defineSecrets } from '@sim/workflow-sdk/workspace'",
      "export default defineSecrets({ ANTHROPIC_API_KEY: { description: 'Model access' } })",
      '',
    ].join('\n')
  )
  writeFileSync(
    join(dir, 'credentials.ts'),
    [
      '// @sim-sdk 1',
      "import { defineCredentials } from '@sim/workflow-sdk/workspace'",
      "export default defineCredentials({ 'ops-slack': { provider: 'slack' } })",
      '',
    ].join('\n')
  )
  mkdirSync(join(dir, 'tables'))
  writeFileSync(
    join(dir, 'tables/contacts.ts'),
    [
      '// @sim-sdk 1',
      "import { column, defineTable } from '@sim/workflow-sdk/workspace'",
      'export default defineTable({',
      "  name: 'contacts',",
      '  columns: {',
      '    email: column.string({ required: true }),',
      "    status: column.select({ options: ['pending', 'synced'] }),",
      '  },',
      '})',
      '',
    ].join('\n')
  )
}

/** A workflow of the workspace naming a table, a credential and an env name: `edit` varies it. */
function workspaceWorkflow(edit: (source: string) => string = (source) => source): string {
  return edit(
    [
      '// @sim-sdk 1',
      "import { credential, env, slack, table, trigger, workflow } from '@sim/workflow-sdk'",
      "export default workflow('W', {}, () => {",
      "  const start = trigger.start('Start', { inputFormat: { email: 'string' } })",
      "  const save = table.insertRow('Save', {",
      "    tableId: table('contacts'),",
      "    data: { email: start.email, status: 'pending' },",
      '  })',
      "  const notify = slack.sendMessage('Notify', {",
      "    credential: credential('ops-slack'),",
      "    destinationType: 'channel',",
      "    channel: 'ops',",
      '    text: env.ANTHROPIC_API_KEY,',
      '  })',
      '  start.to(save)',
      '  save.to(notify)',
      '})',
      '',
    ].join('\n')
  )
}

/** Writes `workflows/<key>/workflow.ts` with no `.sim/` of its own, as a new workflow folder is. */
function writeWorkflowFolder(key: string, source: string): string {
  const folder = join(dir, 'workflows', key)
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, 'workflow.ts'), source)
  return folder
}

async function checkIn(folder: string, ...flags: string[]): Promise<void> {
  const source = new Command('source')
  attachWorkflowSourceCheck(source)
  source.commands.forEach((command) => command.exitOverride())
  await source.parseAsync(['node', 'source', 'check', '--dir', folder, ...flags])
}

/** `CLEAN` plus an API block with an unknown method: `W_UNKNOWN_OPTION` on block `call`. */
const UNKNOWN_METHOD = CLEAN.replace(
  '  start.to(done)',
  "  const call = api('Call', { url: 'https://example.com', method: 'FETCH' })\n  start.to(done)\n  done.to(call)"
).replace('import { response,', 'import { api, response,')

function writeLock(keys: readonly string[]): void {
  writeFileSync(
    join(dir, '.sim/lock.json'),
    JSON.stringify({
      version: 1,
      blocks: Object.fromEntries(
        keys.map((key, order) => [key, { id: `id-${key}`, parent: null, ident: key, order }])
      ),
      variables: {},
    })
  )
}

const TSCONFIG_MARKER_LINE =
  '// Written by `sim workflows source get`; remove this line to keep your own edits.'

function includes(path: string): string[] {
  const text = readFileSync(path, 'utf8')
  return JSON.parse(text.slice(text.indexOf('\n') + 1)).include
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sim-source-check-'))
  mkdirSync(join(dir, '.sim'))
  writeFileSync(
    join(dir, '.sim/base.json'),
    JSON.stringify({ workflowId: 'wf', workspaceId: WORKSPACE_ID, fingerprint: 'sf1:a' })
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

describe('sim workflows source check', () => {
  it('passes a clean source against the cached catalog of the workspace .sim/base.json names', async () => {
    cacheCatalog()
    writeFileSync(join(dir, 'workflow.ts'), CLEAN)

    await check()

    expect(result()).toMatchObject({ checked: 'compile', errors: 0, warnings: 0 })
    expect(process.exitCode).toBeUndefined()
    expect(contextMockFns.mockRequest).not.toHaveBeenCalled()
  })

  it('prints a source error with its location and exits 1', async () => {
    cacheCatalog()
    writeFileSync(
      join(dir, 'workflow.ts'),
      CLEAN.replace('{ body: { received: start.message } }', '{ bdy: { received: start.message } }')
    )

    await check()

    expect(result()).toMatchObject({ errors: 1 })
    expect(stderr()).toMatch(/workflow\.ts:6:\d+ error E_UNKNOWN_PARAM/)
    expect(process.exitCode).toBe(1)
  })

  it('puts each finding in the JSON on stdout', async () => {
    cacheCatalog()
    writeFileSync(
      join(dir, 'workflow.ts'),
      CLEAN.replace('{ body: { received: start.message } }', '{ bdy: { received: start.message } }')
    )

    await check()

    expect(stdoutJson()).toMatchObject({
      errors: 1,
      diagnostics: [
        expect.objectContaining({
          code: 'E_UNKNOWN_PARAM',
          severity: 'error',
          file: 'workflow.ts',
          line: 6,
          message: 'Response has no param bdy.',
        }),
      ],
    })
  })

  it('leaves stored() to the server, which holds the stored values', async () => {
    cacheCatalog()
    writeFileSync(
      join(dir, 'workflow.ts'),
      [
        '// @sim-sdk 1',
        "import { api, stored, trigger, workflow } from '@sim/workflow-sdk'",
        "export default workflow('W', {}, () => {",
        "  const start = trigger.start('Start', {})",
        "  const call = api('Call', { url: 'https://example.com', proxyUrl: stored() })",
        '  start.to(call)',
        '})',
        '',
      ].join('\n')
    )

    await check()

    expect(stderr()).not.toContain('E_STORED_VALUE_MISSING')
  })

  it('refuses without a cached catalog, naming the get that caches one', async () => {
    writeFileSync(join(dir, 'workflow.ts'), CLEAN)

    const error = await check().catch((caught: unknown) => caught)

    expect((error as SimApiError).code).toBe('CATALOG_NOT_CACHED')
    expect((error as SimApiError).message).toContain('sim workflows source get')
  })

  it('points a workspace root at the workspace check', async () => {
    cacheCatalog()
    writeWorkspace()
    writeWorkflowFolder('notify', workspaceWorkflow())

    const error = await check().catch((caught: unknown) => caught)

    expect((error as SimApiError).message).toContain(
      `is a workspace source directory: check it with \`sim workspaces source check --dir ${dir}\``
    )
  })

  it('reads the workspace root .sim/base.json from a new workflow folder that has none', async () => {
    cacheCatalog()
    writeWorkspace()
    const folder = writeWorkflowFolder('notify', workspaceWorkflow())

    await checkIn(folder)

    expect(result()).toMatchObject({ errors: 0, warnings: 0, catalogHash: 'fixture' })
    expect(process.exitCode).toBeUndefined()
  })

  it('refuses a table or credential key the workspace directory does not declare', async () => {
    cacheCatalog()
    writeWorkspace()
    const folder = writeWorkflowFolder(
      'notify',
      workspaceWorkflow((source) =>
        source.replace("table('contacts')", "table('contact')").replace("'ops-slack'", "'ops-slak'")
      )
    )

    await checkIn(folder)

    expect(result()).toMatchObject({ errors: 2 })
    expect(stderr()).toMatch(/workflow\.ts:6:\d+ error E_MAT_UNKNOWN_RESOURCE: No table "contact"/)
    expect(stderr()).toMatch(
      /error E_MAT_UNKNOWN_RESOURCE: No credential "ops-slak"[\s\S]*Keys: ops-slack/
    )
    expect(process.exitCode).toBe(1)
  })

  it('warns on an env name secrets.ts does not declare', async () => {
    cacheCatalog()
    writeWorkspace()
    const folder = writeWorkflowFolder(
      'notify',
      workspaceWorkflow((source) => source.replace('env.ANTHROPIC_API_KEY', 'env.ANTHROPIC_KEY'))
    )

    await checkIn(folder)

    expect(result()).toMatchObject({ errors: 0, warnings: 1 })
    expect(stderr()).toContain('W_ENV_UNKNOWN')
  })

  it('fails a row write naming a column or select option the table does not declare', async () => {
    cacheCatalog()
    writeWorkspace()
    const folder = writeWorkflowFolder(
      'notify',
      workspaceWorkflow((source) =>
        source
          .replace('{ email: start.email,', '{ emial: start.email,')
          .replace("'pending' }", "'done' }")
      )
    )

    await checkIn(folder)

    expect(stderr()).toMatch(
      /error W_TABLE_UNKNOWN_COLUMN: data writes emial[\s\S]*Columns: email, status/
    )
    expect(stderr()).toMatch(
      /error W_UNKNOWN_OPTION: status of table "contacts" has no option done/
    )
    expect(process.exitCode).toBe(1)
  })

  it('fails on a broken new block by default, but not on one the lock binds', async () => {
    cacheCatalog()
    writeFileSync(join(dir, 'workflow.ts'), UNKNOWN_METHOD)

    await check()
    expect(stderr()).toMatch(/error W_UNKNOWN_OPTION/)
    expect(process.exitCode).toBe(1)

    process.exitCode = undefined
    writeLock(['start', 'done', 'call'])
    await check()
    expect(result()).toMatchObject({ errors: 0, warnings: 1 })
    expect(process.exitCode).toBeUndefined()
  })

  it('fails on a bound block with --strict and on nothing with --no-strict', async () => {
    cacheCatalog()
    writeFileSync(join(dir, 'workflow.ts'), UNKNOWN_METHOD)
    writeLock(['start', 'done', 'call'])

    await checkIn(dir, '--strict')
    expect(result()).toMatchObject({ errors: 1 })
    expect(process.exitCode).toBe(1)

    process.exitCode = undefined
    writeLock([])
    await checkIn(dir, '--no-strict')
    expect(result()).toMatchObject({ errors: 0, warnings: 1 })
    expect(process.exitCode).toBeUndefined()
  })

  it('adds a block the edit added to the CLI tsconfig.json, keeping the blocks it includes', async () => {
    cacheCatalog()
    writeFileSync(
      join(dir, 'tsconfig.json'),
      `${TSCONFIG_MARKER_LINE}\n${JSON.stringify({ include: ['workflow.ts', '.sim/sdk/blocks/gmail_v2.d.ts'] })}\n`
    )
    writeFileSync(
      join(dir, 'workflow.ts'),
      CLEAN.replace('import { response,', 'import { response, slack,').replace(
        '  start.to(done)',
        "  const post = slack.sendMessage('Post', { destinationType: 'channel', channel: 'ops', text: 'hi' })\n  start.to(done)\n  done.to(post)"
      )
    )

    await check()

    expect(includes(join(dir, 'tsconfig.json'))).toEqual(
      expect.arrayContaining(['.sim/sdk/blocks/slack_v2.d.ts', '.sim/sdk/blocks/gmail_v2.d.ts'])
    )
    expect(() => readFileSync(join(dir, 'tsconfig.full.json'))).toThrow()
  })
})
