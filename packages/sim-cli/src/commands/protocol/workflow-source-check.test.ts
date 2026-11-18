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

function stderr(): string {
  return vi
    .mocked(console.error)
    .mock.calls.map((call) => call.join(' '))
    .join('\n')
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
})
