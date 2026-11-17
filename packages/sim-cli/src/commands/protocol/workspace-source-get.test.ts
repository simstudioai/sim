import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SimApiError } from '../../http/client'
import { contextMockFns, contextMockState } from '../../test/context-mock'
import { attachWorkspaceSourceGet } from './workspace-source-get'

vi.mock('../../context', async () => (await import('../../test/context-mock')).contextMock)

const { mockRequest: request } = contextMockFns
const SOURCE_PATH = '/api/v2/workspaces/ws_local/source'
const CATALOG_PATH = '/api/v2/workspaces/ws_local/workflows/source/catalog'
const CATALOG = JSON.parse(
  readFileSync(join(__dirname, '../../../../workflow-sdk/test/fixtures/catalog.json'), 'utf8')
)
const LEADS = "// @sim-sdk 1\nexport default defineTable({ name: 'leads', columns: {} })\n"
const ACCOUNTS = "// @sim-sdk 1\nexport default defineTable({ name: 'accounts', columns: {} })\n"

let rootDir: string
let dir: string

function serve(
  files: Record<string, string>,
  { kinds = ['table'], resources = {} }: { kinds?: string[]; resources?: object } = {}
) {
  request.mockImplementation(async (path: string) => {
    if (path === SOURCE_PATH) {
      return {
        data: {
          workspaceId: 'ws_local',
          kinds,
          files,
          blobs: [],
          base: { version: 1, workspaceId: 'ws_local', resources },
          skipped: [],
          diagnostics: [],
        },
      }
    }
    if (path === CATALOG_PATH) return { data: CATALOG }
    throw new SimApiError('not found', 404)
  })
}

async function get(...argv: string[]): Promise<void> {
  const root = new Command('sim')
  attachWorkspaceSourceGet(root.command('workspaces').command('source'))
  root.exitOverride()
  await root.parseAsync(['node', 'sim', 'workspaces', 'source', 'get', '--dir', dir, ...argv])
}

beforeEach(() => {
  contextMockState.output = 'json'
  request.mockReset()
  rootDir = mkdtempSync(join(tmpdir(), 'sim-workspace-get-'))
  dir = join(rootDir, 'out')
  vi.stubEnv('SIM_CONFIG_DIR', join(rootDir, 'config'))
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  rmSync(rootDir, { recursive: true, force: true })
})

describe('workspaces source get', () => {
  it('removes a file whose resource is gone, but refuses to replace an unapplied edit', async () => {
    serve({ 'tables/leads.ts': LEADS, 'tables/accounts.ts': ACCOUNTS })
    await get()
    expect(readFileSync(join(dir, 'tables/accounts.ts'), 'utf8')).toBe(ACCOUNTS)
    expect(existsSync(join(dir, '.sim/sdk/workspace/table.d.ts'))).toBe(true)
    expect(readFileSync(join(dir, '.sim/sdk/workspace.d.ts'), 'utf8')).toContain(
      "import('../../tables/leads')"
    )

    serve({ 'tables/leads.ts': LEADS })
    await get()
    expect(existsSync(join(dir, 'tables/accounts.ts'))).toBe(false)

    writeFileSync(join(dir, 'tables/leads.ts'), `${LEADS}// my edit\n`)
    serve({ 'tables/leads.ts': `${LEADS}// server\n` })
    await expect(get()).rejects.toThrow(/edits no apply has saved \(tables\/leads\.ts\)/)
    expect(readFileSync(join(dir, 'tables/leads.ts'), 'utf8')).toBe(`${LEADS}// my edit\n`)

    await get('--force')
    expect(readFileSync(join(dir, 'tables/leads.ts'), 'utf8')).toBe(`${LEADS}// server\n`)
  })

  it('keeps the base entries of the kinds a get leaves unread', async () => {
    serve(
      { 'tables/leads.ts': LEADS },
      {
        kinds: ['table', 'workflow'],
        resources: {
          'table:leads': { id: 'tbl_1', columns: { email: { id: 'col_1' } } },
          'workflow:old': { id: 'wf_1' },
        },
      }
    )
    await get()

    serve({}, { kinds: ['workflow'], resources: { 'workflow:ingest': { id: 'wf_2' } } })
    await get('--only', 'workflow')

    expect(JSON.parse(readFileSync(join(dir, '.sim/base.json'), 'utf8')).resources).toEqual({
      'table:leads': { id: 'tbl_1', columns: { email: { id: 'col_1' } } },
      'workflow:ingest': { id: 'wf_2' },
    })
  })
})
