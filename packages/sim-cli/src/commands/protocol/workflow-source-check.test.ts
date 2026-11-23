import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SimApiError } from '../../http/client'
import { cacheCatalogText } from '../../test/catalog-cache'
import { contextMockFns, mockedProfile } from '../../test/context-mock'
import { digest } from './source-dir'
import { storedEdgesWrite } from './stored-edges'
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
  cacheCatalogText(join(dir, 'config'), WORKSPACE_ID, readFileSync(FIXTURE_CATALOG, 'utf8'))
}

/** Records in `.sim/base.json` that the source was printed with the fixture catalog, as a get does. */
function printedWithFixture(): void {
  writeFileSync(
    join(dir, '.sim/base.json'),
    JSON.stringify({
      workflowId: 'wf',
      workspaceId: WORKSPACE_ID,
      fingerprint: 'sf1:a',
      catalogHash: 'fixture',
    })
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

/**
 * Source as a get prints stored state the server keeps although new source cannot write it: an
 * error edge out of a loop, a block wired to itself, and a condition branch left unwired.
 */
const STORED_SHAPES = [
  '// @sim-sdk 1',
  "import { api, condition, loop, trigger, workflow } from '@sim/workflow-sdk'",
  "export default workflow('W', {}, () => {",
  "  const start = trigger.start('Start', {})",
  "  const l = loop.for('L', { count: 3 }, (p) => {",
  "    const inner = api('Inner', { url: 'https://example.com', method: 'GET' })",
  '    p.to(inner)',
  '  })',
  "  const fallback = api('Fallback', { url: 'https://example.com', method: 'GET' })",
  "  const a = api('A', { url: 'https://example.com', method: 'GET' })",
  "  const route = condition('Route', { hot: 'x > 1', else: true })",
  '  start.to(l)',
  '  l.onError(fallback)',
  '  l.to(a)',
  '  a.to(a)',
  '  a.to(route)',
  '  route.hot.to(fallback)',
  '})',
  '',
].join('\n')

/** `STORED_SHAPES` with the loop and the self-wired block renamed, their idents kept. */
const STORED_SHAPES_RENAMED = STORED_SHAPES.replace(
  "loop.for('L',",
  "loop.for('Retry Loop',"
).replace("api('A',", "api('Alpha',")

function writeLock(keys: readonly string[], parents: Record<string, string> = {}): void {
  writeFileSync(
    join(dir, '.sim/lock.json'),
    JSON.stringify({
      version: 1,
      blocks: Object.fromEntries(
        keys.map((key, order) => [
          key,
          { id: `id-${key}`, parent: parents[key] ?? null, ident: key, order },
        ])
      ),
      variables: {},
    })
  )
}

/** Records `files` in `.sim/written.json` as a get leaves them. */
function writeWritten(files: Record<string, string>): void {
  writeFileSync(
    join(dir, '.sim/written.json'),
    JSON.stringify({
      version: 1,
      files: Object.fromEntries(Object.entries(files).map(([path, text]) => [path, digest(text)])),
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
    expect(findingLines()).toMatch(/workflow\.ts:6:\d+ error E_UNKNOWN_PARAM/)
    expect(process.exitCode).toBe(1)
  })

  it('fails on a lock every apply refuses, a block cap over its limit included, saying how to recover', async () => {
    cacheCatalog()
    writeFileSync(join(dir, 'workflow.ts'), CLEAN)
    const blocks = Object.fromEntries(
      Array.from({ length: 2001 }, (_, index) => [
        `b${index}`,
        { id: `id-${index}`, parent: null, ident: `b${index}`, order: index },
      ])
    )
    writeFileSync(
      join(dir, '.sim/lock.json'),
      JSON.stringify({ version: 1, blocks, variables: {} })
    )

    await check()

    expect(result()).toMatchObject({ errors: 1 })
    expect(result().diagnostics).toEqual([
      expect.objectContaining({
        code: 'E_LOCK_SHAPE',
        severity: 'error',
        file: '.sim/lock.json',
        path: '/blocks',
        message: 'Expected at most 2000 entries. Every apply and status refuses this lock.',
        hint: expect.stringContaining(
          'Restore .sim/lock.json from version control, or write the source into a fresh directory (`sim workflows source get <workflowId> --dir <new dir>`'
        ),
      }),
    ])
    expect(process.exitCode).toBe(1)
  })

  it('fails on a lock that is not JSON, and passes with no lock at all', async () => {
    cacheCatalog()
    writeFileSync(join(dir, 'workflow.ts'), CLEAN)
    writeFileSync(join(dir, '.sim/lock.json'), '{ "version": 1,')

    await check()

    expect(result()).toMatchObject({ errors: 1 })
    expect(findingLines()).toContain('error E_LOCK_JSON')
    expect(process.exitCode).toBe(1)

    process.exitCode = undefined
    vi.mocked(console.log).mockClear()
    rmSync(join(dir, '.sim/lock.json'))
    await check()
    expect(result()).toMatchObject({ errors: 0 })
    expect(process.exitCode).toBeUndefined()
  })

  it('refuses a codeFile() path holding a NUL byte by its code, reading no such file', async () => {
    cacheCatalog()
    writeFileSync(
      join(dir, 'workflow.ts'),
      CLEAN.replace('import { response,', 'import { codeFile, fn, response,').replace(
        '  start.to(done)',
        "  const step = fn('Step', { code: codeFile('./functions/\\u0000x.js') })\n  start.to(done)"
      )
    )

    await check()

    expect(findingLines()).toMatch(/error E_CODE_FILE_PATH/)
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

  it('with --output json, prints each finding in the JSON only, not again as a frame on stderr', async () => {
    cacheCatalog()
    writeFileSync(
      join(dir, 'workflow.ts'),
      CLEAN.replace('{ body: { received: start.message } }', '{ bdy: { received: start.message } }')
    )

    await check()

    expect(stdoutJson()).toMatchObject({ diagnostics: [{ code: 'E_UNKNOWN_PARAM' }] })
    expect(vi.mocked(console.error)).not.toHaveBeenCalled()
  })

  it('with --output json in a GitHub Actions job, still annotates each finding on stderr, as a workflow command only', async () => {
    vi.stubEnv('GITHUB_ACTIONS', 'true')
    cacheCatalog()
    writeFileSync(
      join(dir, 'workflow.ts'),
      CLEAN.replace('{ body: { received: start.message } }', '{ bdy: { received: start.message } }')
    )

    await check()

    expect(stdoutJson()).toMatchObject({ diagnostics: [{ code: 'E_UNKNOWN_PARAM' }] })
    const stderr = vi.mocked(console.error).mock.calls.map((call) => call.join(' '))
    expect(stderr).toEqual([expect.stringMatching(/^::error file=.*,title=E_UNKNOWN_PARAM::/)])
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

    expect(findingLines()).not.toContain('E_STORED_VALUE_MISSING')
  })

  it('refuses without a cached catalog, naming the get that caches one', async () => {
    writeFileSync(join(dir, 'workflow.ts'), CLEAN)

    const error = await check().catch((caught: unknown) => caught)

    expect((error as SimApiError).code).toBe('CATALOG_NOT_CACHED')
    expect((error as SimApiError).message).toContain('sim workflows source get')
  })

  it('refuses a directory without workflow.ts before looking for a catalog, by its absolute path', async () => {
    const error = await check().catch((caught: unknown) => caught)

    expect((error as SimApiError).code).not.toBe('CATALOG_NOT_CACHED')
    expect((error as SimApiError).message).toContain(`${dir} has no workflow.ts`)
  })

  it('refuses a --workspace naming another workspace than .sim/base.json, and only that', async () => {
    cacheCatalog()
    writeFileSync(join(dir, 'workflow.ts'), CLEAN)
    contextMockFns.mockProfileFrom.mockReturnValue({
      ...mockedProfile(),
      workspaceId: 'ws_other',
      output: 'json',
      sources: { workspaceId: 'flag' },
    })

    const error = await check().catch((caught: unknown) => caught)

    expect((error as SimApiError).code).toBe('SOURCE_OTHER_WORKSPACE')
    expect((error as SimApiError).message).toContain(`was read from workspace ${WORKSPACE_ID}`)
  })

  it('points a workspace root at the workspace check', async () => {
    cacheCatalog()
    writeWorkspace()
    writeWorkflowFolder('notify', workspaceWorkflow())

    const error = await check().catch((caught: unknown) => caught)

    expect((error as SimApiError).message).toContain('is a workspace source directory')
    expect((error as SimApiError).message).toContain(
      `\`sim workspaces source\` (check, status, apply) --dir ${dir}`
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
    expect(findingLines()).toMatch(
      /workflow\.ts:6:\d+ error E_MAT_UNKNOWN_RESOURCE: No table "contact"/
    )
    expect(findingLines()).toMatch(
      /error E_MAT_UNKNOWN_RESOURCE: No credential "ops-slak"[\s\S]*Keys: ops-slack/
    )
    expect(process.exitCode).toBe(1)
  })

  it('warns on an env name secrets.ts does not declare, without claiming the workspace lacks it', async () => {
    cacheCatalog()
    writeWorkspace()
    const folder = writeWorkflowFolder(
      'notify',
      workspaceWorkflow((source) => source.replace('env.ANTHROPIC_API_KEY', 'env.ANTHROPIC_KEY'))
    )

    await checkIn(folder)

    expect(result()).toMatchObject({ errors: 0, warnings: 1 })
    expect(findingLines()).toContain('W_ENV_UNKNOWN')
    expect(findingLines()).toContain('secrets.ts does not declare ANTHROPIC_KEY')
    expect(findingLines()).not.toContain('The workspace has no env variable')
  })

  it('annotates each finding at its file, line and column in a GitHub Actions job', async () => {
    vi.stubEnv('GITHUB_ACTIONS', 'true')
    cacheCatalog()
    writeWorkspace()
    const folder = writeWorkflowFolder(
      'notify',
      workspaceWorkflow((source) => source.replace('env.ANTHROPIC_API_KEY', 'env.ANTHROPIC_KEY'))
    )

    await checkIn(folder)

    const annotations = vi
      .mocked(console.error)
      .mock.calls.map((call) => call.join(' '))
      .filter((line) => line.startsWith('::'))
    expect(annotations).toHaveLength(1)
    expect(annotations[0]).toMatch(
      new RegExp(
        `^::warning file=${join(folder, 'workflow.ts')},line=\\d+,col=\\d+,title=W_ENV_UNKNOWN::secrets.ts does not declare ANTHROPIC_KEY`
      )
    )
  })

  it('lists at most 20 warnings of one code, as a workflow answer does, and counts every one', async () => {
    cacheCatalog()
    writeWorkspace()
    const unknown = Array.from({ length: 25 }, (_, index) => `extra${index}: 'x'`).join(', ')
    const folder = writeWorkflowFolder(
      'flood',
      workspaceWorkflow((source) =>
        source.replace("data: { email: start.email, status: 'pending' }", `data: { ${unknown} }`)
      )
    )

    await checkIn(folder, '--no-strict')

    const answer = result()
    expect(answer).toMatchObject({ errors: 0, warnings: 25 })
    const codes = (answer.diagnostics as Array<{ code: string }>).map((finding) => finding.code)
    expect(codes.filter((code) => code === 'W_TABLE_UNKNOWN_COLUMN')).toHaveLength(20)
    expect(codes.filter((code) => code === 'I_FINDINGS_TRUNCATED')).toHaveLength(1)
  })

  it('counts every literal secret it fails on, past the 20 of one code it lists', async () => {
    cacheCatalog()
    const bearer = `Bearer ${'sk-proj-'}${'Abc123Def456Ghi789Jkl012'}`
    const calls = Array.from(
      { length: 25 },
      (_, index) =>
        `  const call${index} = api('Call ${index}', { url: 'https://api.example.com/v1', method: 'GET', headers: [{ cells: { Key: 'Authorization', Value: '${bearer}' } }] })\n  start.to(call${index})`
    ).join('\n')
    writeFileSync(
      join(dir, 'workflow.ts'),
      CLEAN.replace('import { response,', 'import { api, response,').replace(
        '  start.to(done)',
        `${calls}\n  start.to(done)`
      )
    )

    await check()

    const answer = result()
    expect(answer).toMatchObject({ errors: 25 })
    const codes = (answer.diagnostics as Array<{ code: string }>).map((finding) => finding.code)
    expect(codes.filter((code) => code === 'W_LITERAL_SECRET')).toHaveLength(20)
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

    expect(findingLines()).toMatch(
      /error W_TABLE_UNKNOWN_COLUMN: data writes emial[\s\S]*Columns: email, status/
    )
    expect(findingLines()).toMatch(
      /error W_UNKNOWN_OPTION: status of table "contacts" has no option done/
    )
    expect(process.exitCode).toBe(1)
  })

  it('names the column a row write meant when it writes the key of a renamed column', async () => {
    cacheCatalog()
    writeWorkspace()
    const table = join(dir, 'tables/contacts.ts')
    writeFileSync(
      table,
      readFileSync(table, 'utf8').replace(
        'email: column.string({ required: true })',
        "email: column.string({ name: 'contact', required: true })"
      )
    )
    const folder = writeWorkflowFolder('notify', workspaceWorkflow())

    await checkIn(folder)

    expect(findingLines()).toContain(
      'error W_TABLE_UNKNOWN_COLUMN: data writes email, the key of column "contact" of table "contacts": row data is keyed by column name, so the run drops it.\n  hint: Did you mean contact?'
    )
  })

  it('fails on a broken new block by default, but not on one the lock binds', async () => {
    cacheCatalog()
    writeFileSync(join(dir, 'workflow.ts'), UNKNOWN_METHOD)

    await check()
    expect(findingLines()).toMatch(
      /error E_APPLY_INVALID_SUBBLOCK_FIELD: method has no option FETCH\./
    )
    expect(findingLines()).not.toContain('kept as written')
    expect(process.exitCode).toBe(1)

    process.exitCode = undefined
    writeLock(['start', 'done', 'call'])
    await check()
    expect(result()).toMatchObject({ errors: 0, warnings: 1 })
    expect(process.exitCode).toBeUndefined()
  })

  it('reports an untyped JSON reference only on a block the lock does not bind, and on all with --strict', async () => {
    cacheCatalog()
    writeFileSync(
      join(dir, 'workflow.ts'),
      CLEAN.replace(
        "const done = response('Done', { body: { received: start.message } })",
        "const calc = fn('Calc', { code: 'return 1' })\n  const call = api('Call', { url: 'https://x', method: 'POST', body: { n: calc.result.deep } })\n  const done = response('Done', { body: { received: start.message } })"
      ).replace('import { response,', 'import { api, fn, response,')
    )
    const untyped = () =>
      ((result().diagnostics ?? []) as Array<{ code: string }>).filter(
        (finding) => finding.code === 'W_JSON_REF_UNTYPED'
      )

    await check()
    expect(untyped()).toHaveLength(1)

    writeLock(['start', 'done', 'calc', 'call'])
    await check()
    expect(untyped()).toEqual([])

    await checkIn(dir, '--strict')
    expect(untyped()).toHaveLength(1)
  })

  it('fails on an iteration reference a new block reads outside its loop, and on one a move left behind', async () => {
    cacheCatalog()
    const source = (echo: string) => `// @sim-sdk 1
import { fn, loop, trigger, workflow } from '@sim/workflow-sdk'

export default workflow('W', {}, () => {
  const start = trigger.start('Start', {})
  const each = loop.for('Each', { count: 2 }, (p) => {
    const inner = fn('Inner', { code: 'return 1' })
    p.to(inner)
  })
  ${echo}
  start.to(each)
})
`
    const scoped = () =>
      ((result().diagnostics ?? []) as Array<{ code: string; severity: string }>).filter(
        (finding) => finding.code.includes('OUT_OF_SCOPE')
      )
    writeFileSync(
      join(dir, 'workflow.ts'),
      source("const echo = fn('Echo', { code: 'return <loop.index>' })")
    )

    await check()
    expect(scoped()).toEqual([
      expect.objectContaining({ code: 'E_APPLY_REF_OUT_OF_SCOPE', severity: 'error' }),
    ])

    writeLock(['start', 'each', 'inner', 'echo'], { inner: 'each', echo: 'each' })
    await check()
    expect(scoped()).toEqual([
      expect.objectContaining({ code: 'E_APPLY_REF_OUT_OF_SCOPE', severity: 'error' }),
    ])

    writeLock(['start', 'each', 'inner', 'echo'], { inner: 'each' })
    process.exitCode = undefined
    await check()
    expect(scoped()).toEqual([
      expect.objectContaining({ code: 'W_REF_OUT_OF_SCOPE', severity: 'warning' }),
    ])
    expect(process.exitCode).toBeUndefined()
  })

  it('fails on an iteration reference an edit types into a block the lock binds outside its loop', async () => {
    cacheCatalog()
    const source = (code: string) => `// @sim-sdk 1
import { fn, loop, trigger, workflow } from '@sim/workflow-sdk'

export default workflow('W', {}, () => {
  const start = trigger.start('Start', {})
  const each = loop.for('Each', { count: 2 }, (p) => {
    const inner = fn('Inner', { code: 'return 1' })
    p.to(inner)
  })
  const echo = fn('Echo', { code: '${code}' })
  start.to(each)
})
`
    const lock = {
      version: 1,
      blocks: {
        start: { id: 'id-start', parent: null, ident: 'start', order: 0 },
        each: { id: 'id-each', parent: null, ident: 'each', order: 1 },
        inner: { id: 'id-inner', parent: 'each', ident: 'inner', order: 2 },
        echo: { id: 'id-echo', parent: null, ident: 'echo', order: 3 },
      },
      variables: {},
    }
    const printed = source('return 1')
    printedWithFixture()
    writeFileSync(join(dir, 'workflow.ts'), printed)
    writeFileSync(join(dir, '.sim/lock.json'), JSON.stringify(lock))
    const record = storedEdgesWrite(
      { files: { 'workflow.ts': printed }, lock, base: { fingerprint: 'sf1:a' } },
      JSON.parse(readFileSync(FIXTURE_CATALOG, 'utf8'))
    )
    if (!record) throw new Error('no stored-edges record')
    writeFileSync(join(dir, record[0]), record[1])
    writeFileSync(join(dir, 'workflow.ts'), source('return <loop.index>'))

    await check()

    expect(
      ((result().diagnostics ?? []) as Array<{ code: string; severity: string }>).filter(
        (finding) => finding.code.includes('OUT_OF_SCOPE')
      )
    ).toEqual([expect.objectContaining({ code: 'E_APPLY_REF_OUT_OF_SCOPE', severity: 'error' })])
    expect(process.exitCode).toBe(1)
  })

  it('fails on $ref in a Python function file, naming the tag the file writes instead', async () => {
    cacheCatalog()
    mkdirSync(join(dir, 'functions'), { recursive: true })
    writeFileSync(join(dir, 'functions/total.py'), 'q = $ref.start.q\nreturn q\n')
    writeFileSync(
      join(dir, 'workflow.ts'),
      `// @sim-sdk 1
import { codeFile, fn, trigger, workflow } from '@sim/workflow-sdk'

export default workflow('W', {}, () => {
  const start = trigger.start('Start', { inputFormat: { q: 'string' } })
  const total = fn('Total', { language: 'python', code: codeFile('./functions/total.py') })
  start.to(total)
})
`
    )

    await check()
    expect(result().diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'E_APPLY_CODE_FILE_REF_SYNTAX',
        severity: 'error',
        file: 'functions/total.py',
        line: 1,
      })
    )
    expect(process.exitCode).toBe(1)
  })

  it('fails on a dangling $ref in a new function file by default, and on any with --strict', async () => {
    cacheCatalog()
    mkdirSync(join(dir, 'functions'), { recursive: true })
    writeFileSync(join(dir, 'functions/total.js'), 'return $ref.ordertotals.sum\n')
    writeFileSync(
      join(dir, 'workflow.ts'),
      `// @sim-sdk 1
import { codeFile, fn, trigger, workflow } from '@sim/workflow-sdk'

export default workflow('W', {}, () => {
  const start = trigger.start('Start', {})
  const total = fn('Total', { code: codeFile('./functions/total.js') })
  start.to(total)
})
`
    )

    await check()
    expect(result().diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'E_APPLY_UNRESOLVED_REF',
        severity: 'error',
        file: 'functions/total.js',
        line: 1,
        column: 8,
      })
    )
    expect(process.exitCode).toBe(1)

    process.exitCode = undefined
    writeLock(['start', 'total'])
    writeWritten({ 'functions/total.js': 'return $ref.ordertotals.sum\n' })
    await check()
    expect(result()).toMatchObject({ errors: 0, warnings: 1 })
    expect(process.exitCode).toBeUndefined()

    await checkIn(dir, '--strict')
    expect(result()).toMatchObject({ errors: 1 })
    expect(process.exitCode).toBe(1)
  })

  it('fails on a dangling $ref the edit wrote into a bound function file, whatever the strict mode', async () => {
    cacheCatalog()
    mkdirSync(join(dir, 'functions'), { recursive: true })
    writeFileSync(
      join(dir, 'workflow.ts'),
      `// @sim-sdk 1
import { codeFile, fn, trigger, workflow } from '@sim/workflow-sdk'

export default workflow('W', {}, () => {
  const start = trigger.start('Start', {})
  const total = fn('Total', { code: codeFile('./functions/total.js') })
  start.to(total)
})
`
    )
    writeLock(['start', 'total'])
    writeWritten({ 'functions/total.js': 'return 1\n' })
    writeFileSync(join(dir, 'functions/total.js'), 'return $ref.ordertotals.sum\n')

    for (const flags of [[], ['--no-strict']]) {
      process.exitCode = undefined
      await checkIn(dir, ...flags)
      expect(result().diagnostics).toContainEqual(
        expect.objectContaining({
          code: 'E_APPLY_UNRESOLVED_REF',
          severity: 'error',
          file: 'functions/total.js',
        })
      )
      expect(process.exitCode).toBe(1)
    }
  })

  it('keeps a stored dangling $ref a warning when only its function file was renamed', async () => {
    cacheCatalog()
    mkdirSync(join(dir, 'functions'), { recursive: true })
    writeFileSync(
      join(dir, 'workflow.ts'),
      `// @sim-sdk 1
import { codeFile, fn, trigger, workflow } from '@sim/workflow-sdk'

export default workflow('W', {}, () => {
  const start = trigger.start('Start', {})
  const total = fn('Total', { code: codeFile('./functions/sum.js') })
  start.to(total)
})
`
    )
    writeFileSync(
      join(dir, '.sim/lock.json'),
      JSON.stringify({
        version: 1,
        blocks: {
          start: { id: 'id-start', parent: null, ident: 'start', order: 0 },
          total: {
            id: 'id-total',
            parent: null,
            ident: 'total',
            order: 1,
            codeFile: 'functions/total.js',
          },
        },
        variables: {},
      })
    )
    writeWritten({ 'functions/total.js': 'return $ref.ordertotals.sum\n' })
    writeFileSync(join(dir, 'functions/sum.js'), 'return $ref.ordertotals.sum\n')

    for (const flags of [[], ['--no-strict']]) {
      process.exitCode = undefined
      await checkIn(dir, ...flags)
      expect(result()).toMatchObject({ errors: 0, warnings: 1 })
      expect(process.exitCode).toBeUndefined()
    }
  })

  it('fails on a dangling $ref in an unedited file that a bound block now runs instead of its own', async () => {
    cacheCatalog()
    mkdirSync(join(dir, 'functions'), { recursive: true })
    writeFileSync(
      join(dir, 'workflow.ts'),
      `// @sim-sdk 1
import { codeFile, fn, trigger, workflow } from '@sim/workflow-sdk'

export default workflow('W', {}, () => {
  const start = trigger.start('Start', {})
  const total = fn('Total', { code: codeFile('./functions/sum.js') })
  const sum = fn('Sum', { code: codeFile('./functions/sum.js') })
  start.to(total)
  total.to(sum)
})
`
    )
    const blocks = (codeFiles: Record<string, string>) =>
      Object.fromEntries(
        ['start', 'total', 'sum'].map((key, order) => [
          key,
          {
            id: `id-${key}`,
            parent: null,
            ident: key,
            order,
            ...(codeFiles[key] ? { codeFile: codeFiles[key] } : {}),
          },
        ])
      )
    writeFileSync(
      join(dir, '.sim/lock.json'),
      JSON.stringify({
        version: 1,
        blocks: blocks({ total: 'functions/total.js', sum: 'functions/sum.js' }),
        variables: {},
      })
    )
    writeWritten({
      'functions/total.js': 'return 1\n',
      'functions/sum.js': 'return $ref.ordertotals.sum\n',
    })
    writeFileSync(join(dir, 'functions/sum.js'), 'return $ref.ordertotals.sum\n')

    await check()

    expect(result().diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'E_APPLY_UNRESOLVED_REF',
        severity: 'error',
        file: 'functions/sum.js',
      })
    )
  })

  it('keeps a $ref to a block the source no longer declares a warning, as the server may infer its rename', async () => {
    cacheCatalog()
    mkdirSync(join(dir, 'functions'), { recursive: true })
    writeFileSync(
      join(dir, 'workflow.ts'),
      `// @sim-sdk 1
import { codeFile, fn, trigger, workflow } from '@sim/workflow-sdk'

export default workflow('W', {}, () => {
  const start = trigger.start('Start', {})
  const bang = fn('Bang', { code: 'return 1' })
  const report = fn('Report', { code: codeFile('./functions/report.js') })
  start.to(bang)
  bang.to(report)
})
`
    )
    writeLock(['start', 'boom', 'report'])
    writeWritten({ 'functions/report.js': 'return $ref.boom.result\n' })
    writeFileSync(join(dir, 'functions/report.js'), 'return $ref.boom.result + 1\n')

    await check()

    expect(result()).toMatchObject({ errors: 0 })
    expect(result().diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'W_UNRESOLVED_REF',
        severity: 'warning',
        file: 'functions/report.js',
      })
    )
  })

  it('still fails on a missing block past the warning cap when the listed ones may be renames', async () => {
    cacheCatalog()
    mkdirSync(join(dir, 'functions'), { recursive: true })
    writeFileSync(
      join(dir, 'workflow.ts'),
      `// @sim-sdk 1
import { codeFile, fn, trigger, workflow } from '@sim/workflow-sdk'

export default workflow('W', {}, () => {
  const start = trigger.start('Start', {})
  const bang = fn('Bang', { code: 'return 1' })
  const report = fn('Report', { code: codeFile('./functions/report.js') })
  start.to(bang)
  bang.to(report)
})
`
    )
    writeLock(['start', 'boom', 'report'])
    writeWritten({ 'functions/report.js': 'return 1\n' })
    const renamed = Array.from({ length: 20 }, (_, i) => `$ref.boom.r${i}`)
    writeFileSync(
      join(dir, 'functions/report.js'),
      `return [${[...renamed, '$ref.nosuchblock.value'].join(', ')}]\n`
    )

    await check()

    expect(result().diagnostics).toContainEqual(
      expect.objectContaining({ code: 'E_APPLY_UNRESOLVED_REF', file: 'functions/report.js' })
    )
  })

  it('counts every refused reference in an edited code file as an error, past the 20 of one code it lists', async () => {
    cacheCatalog()
    mkdirSync(join(dir, 'functions'), { recursive: true })
    writeFileSync(
      join(dir, 'workflow.ts'),
      `// @sim-sdk 1
import { codeFile, fn, trigger, workflow } from '@sim/workflow-sdk'

export default workflow('W', {}, () => {
  const start = trigger.start('Start', {})
  const report = fn('Report', { code: codeFile('./functions/report.js') })
  start.to(report)
})
`
    )
    writeLock(['start', 'report'])
    writeWritten({ 'functions/report.js': 'return 1\n' })
    const missing = Array.from({ length: 25 }, (_, i) => `$ref.nosuchblock.v${i}`)
    writeFileSync(join(dir, 'functions/report.js'), `return [${missing.join(', ')}]\n`)

    await check()

    const answer = result()
    expect(answer).toMatchObject({ errors: 25, warnings: 0 })
    const codes = (answer.diagnostics as Array<{ code: string }>).map((finding) => finding.code)
    expect(codes.filter((code) => code === 'E_APPLY_UNRESOLVED_REF')).toHaveLength(20)
  })

  describe('a reference to an output the block lacks', () => {
    /** Start → Call (an HTTP request) → Done, whose JSON body reads `call.<output>`. */
    const reads = (output: string) =>
      CLEAN.replace(
        "const done = response('Done', { body: { received: start.message } })",
        `const call = api('Call', { url: 'https://example.com', method: 'GET' })\n  const done = response('Done', { body: { items: call.${output} } })`
      )
        .replace('  start.to(done)', '  start.to(call)\n  call.to(done)')
        .replace('import { response,', 'import { api, response,')

    /** Writes `printed` as a get leaves it: the source, its lock and its stored-edges record. */
    function writePrinted(printed: string): void {
      const lock = {
        version: 1,
        blocks: Object.fromEntries(
          ['start', 'call', 'done'].map((key, order) => [
            key,
            { id: `id-${key}`, parent: null, ident: key, order },
          ])
        ),
        variables: {},
      }
      printedWithFixture()
      writeFileSync(join(dir, 'workflow.ts'), printed)
      writeFileSync(join(dir, '.sim/lock.json'), JSON.stringify(lock))
      const record = storedEdgesWrite(
        { files: { 'workflow.ts': printed }, lock, base: { fingerprint: 'sf1:a' } },
        JSON.parse(readFileSync(FIXTURE_CATALOG, 'utf8'))
      )
      if (!record) throw new Error('no stored-edges record')
      writeFileSync(join(dir, record[0]), record[1])
    }

    const findings = () =>
      ((result().diagnostics ?? []) as Array<{ code: string; severity: string }>).map(
        ({ code, severity }) => `${severity} ${code}`
      )

    it('fails as the server refuses it once an edit types it into a block the lock binds', async () => {
      cacheCatalog()
      writePrinted(reads('data'))
      await check()
      expect(result()).toMatchObject({ errors: 0 })

      writeFileSync(join(dir, 'workflow.ts'), reads('dataa'))
      await check()

      expect(findings()).toEqual(['error E_APPLY_UNRESOLVED_REF'])
      expect(process.exitCode).toBe(1)
    })

    it('stays a warning on a block the stored workflow already holds that way', async () => {
      cacheCatalog()
      writePrinted(reads('dataa'))
      await check()
      expect(findings()).toEqual(['warning W_UNKNOWN_OUTPUT_PATH'])
      expect(process.exitCode).toBeUndefined()
    })

    it('fails with --no-strict too, as the server refuses it whatever the client asks', async () => {
      cacheCatalog()
      writePrinted(reads('data'))
      writeFileSync(join(dir, 'workflow.ts'), reads('dataa'))
      await checkIn(dir, '--no-strict')
      expect(findings()).toEqual(['error E_APPLY_UNRESOLVED_REF'])
      expect(process.exitCode).toBe(1)
    })

    it('claims no refusal when the catalog the source was printed with is not cached', async () => {
      cacheCatalog()
      writePrinted(reads('data'))
      writeFileSync(
        join(dir, '.sim/base.json'),
        JSON.stringify({ workflowId: 'wf', workspaceId: WORKSPACE_ID, fingerprint: 'sf1:a' })
      )
      writeFileSync(join(dir, 'workflow.ts'), reads('dataa'))
      await check()
      expect(findings()).toEqual(['warning W_UNKNOWN_OUTPUT_PATH'])
      expect(process.exitCode).toBeUndefined()
    })

    it('keeps x.error on a block with no error edge a warning, which the server never refuses', async () => {
      cacheCatalog()
      writePrinted(reads('data'))
      writeFileSync(join(dir, 'workflow.ts'), reads('error'))
      await check()
      expect(findings()).toEqual(['warning W_OUTPUT_PATH_UNDECLARED'])
      expect(process.exitCode).toBeUndefined()
    })
  })

  it('fails on a bound block with --strict and on nothing with --no-strict', async () => {
    cacheCatalog()
    writeFileSync(join(dir, 'workflow.ts'), UNKNOWN_METHOD)
    writeLock(['start', 'done', 'call'])

    await checkIn(dir, '--strict')
    expect(result()).toMatchObject({ errors: 1 })
    expect(process.exitCode).toBe(1)

    process.exitCode = undefined
    await checkIn(dir, '--no-strict')
    expect(result()).toMatchObject({ errors: 0, warnings: 1 })
    expect(process.exitCode).toBeUndefined()
  })

  it('fails with --no-strict on a dropdown value a new block sets, as the server refuses it', async () => {
    cacheCatalog()
    writeFileSync(join(dir, 'workflow.ts'), UNKNOWN_METHOD)
    writeLock([])

    await checkIn(dir, '--no-strict')

    expect(result()).toMatchObject({ errors: 1, warnings: 0 })
    expect(findingLines()).toMatch(
      /error E_APPLY_INVALID_SUBBLOCK_FIELD: method has no option FETCH\./
    )
    expect(process.exitCode).toBe(1)
  })

  it('keeps a value outside options that vary by deployment a warning on a new block under the default strict mode, as the cached catalog may predate the settings the server checks with', async () => {
    cacheCatalog()
    writeFileSync(
      join(dir, 'workflow.ts'),
      CLEAN.replace(
        '  start.to(done)',
        "  const run = fn('Run', { language: 'shell', code: 'echo hi' })\n  start.to(done)\n  done.to(run)"
      ).replace('import { response,', 'import { fn, response,')
    )
    writeLock([])

    await checkIn(dir)

    expect(findingLines()).toMatch(/warning W_UNKNOWN_OPTION: language has no option shell/)
    expect(result()).toMatchObject({ errors: 0 })
    expect(process.exitCode).toBeUndefined()
  })

  it('passes what a get prints from stored state the server keeps: a loop error edge, a cycle, an unwired branch', async () => {
    cacheCatalog()
    writeFileSync(join(dir, 'workflow.ts'), STORED_SHAPES)
    writeLock(['start', 'l', 'inner', 'fallback', 'a', 'route'])

    await check()
    expect(findingLines()).toMatch(/warning W_ERROR_PORT_STORED/)
    expect(findingLines()).toMatch(/warning W_EDGE_CYCLE/)
    expect(findingLines()).toMatch(/warning W_BRANCH_UNWIRED/)
    expect(findingLines()).toMatch(
      /keeps this error edge only if the stored workflow already holds it/
    )
    expect(result()).toMatchObject({ errors: 0 })
    expect(process.exitCode).toBeUndefined()

    await checkIn(dir, '--strict')
    expect(result()).toMatchObject({ errors: 0 })
    expect(process.exitCode).toBeUndefined()
  })

  it('passes that stored state on blocks renamed in source, which keep their lock ident', async () => {
    cacheCatalog()
    writeFileSync(join(dir, 'workflow.ts'), STORED_SHAPES_RENAMED)
    writeLock(['start', 'l', 'inner', 'fallback', 'a', 'route'])

    await check()
    expect(findingLines()).toMatch(/warning W_ERROR_PORT_STORED/)
    expect(findingLines()).toMatch(/warning W_EDGE_CYCLE/)
    expect(result()).toMatchObject({ errors: 0 })
    expect(process.exitCode).toBeUndefined()
  })

  it('refuses that stored state on renamed blocks whose ident the lock does not hold', async () => {
    cacheCatalog()
    writeFileSync(
      join(dir, 'workflow.ts'),
      STORED_SHAPES_RENAMED.replace(/\bl\b/g, 'retry').replace(/\ba\b/g, 'alpha')
    )
    writeLock(['start', 'l', 'inner', 'fallback', 'a', 'route'])

    await check()
    expect(findingLines()).toMatch(/error E_ERROR_PORT_UNSUPPORTED/)
    expect(findingLines()).toMatch(/error E_EDGE_CYCLE/)
    expect(process.exitCode).toBe(1)
  })

  it('refuses a loop error edge and a cycle on blocks the lock does not bind', async () => {
    cacheCatalog()
    writeFileSync(join(dir, 'workflow.ts'), STORED_SHAPES)
    writeLock(['start', 'inner', 'fallback', 'route'])

    await check()
    expect(findingLines()).toMatch(/error E_ERROR_PORT_UNSUPPORTED/)
    expect(findingLines()).toMatch(/error E_EDGE_CYCLE/)
    expect(process.exitCode).toBe(1)
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
  })
})
