import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SimApiError } from '../../http/client'
import { buildGeneratedCommands } from '../../runtime/build'
import { contextMockFns, contextMockState } from '../../test/context-mock'
import { attachWorkflowSourceGet } from './workflow-source-get'

vi.mock('../../context', async () => (await import('../../test/context-mock')).contextMock)

const { mockRequest: request } = contextMockFns

const WORKFLOW_ID = '00000000-0000-4000-8000-00000000000a'
const WORKSPACE_ID = '00000000-0000-4000-8000-00000000000b'
const SOURCE_PATH = `/api/v2/workflows/${WORKFLOW_ID}/source`
const CATALOG_PATH = `/api/v2/workspaces/${WORKSPACE_ID}/block-catalog`
const MANIFEST_PATH = `/api/v2/workspaces/${WORKSPACE_ID}/resource-manifest`

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
      lock: { lockVersion: 1, blocks: {}, variables: {} },
      lockBase: { workspaceId: WORKSPACE_ID, baseFingerprint: 'sf1:x', catalogHash: CATALOG.hash },
      fingerprint: 'sf1:x',
      canonicalHash: 'h',
      catalogVersion: CATALOG.hash,
      sdkMajor: 1,
      blockTypes,
      warnings: [],
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
    bindings: [],
    workflows: [],
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

describe('sim workflows source get --out', () => {
  it('writes the source, lock, base, an agent guide and declarations for every block in the workspace catalog', async () => {
    serve({
      [SOURCE_PATH]: () =>
        source({ 'workflow.ts': '// @sim-sdk 1\n', 'functions/score.js': 'return 1\n' }),
    })

    await get('--out', outDir)

    expect(readFileSync(join(outDir, 'functions/score.js'), 'utf8')).toBe('return 1\n')
    expect(JSON.parse(readFileSync(join(outDir, '.sim/lock.json'), 'utf8')).lockVersion).toBe(1)
    expect(JSON.parse(readFileSync(join(outDir, '.sim/base.json'), 'utf8')).baseFingerprint).toBe(
      'sf1:x'
    )
    expect(existsSync(join(outDir, '.sim/sdk/core.d.ts'))).toBe(true)
    expect(existsSync(join(outDir, '.sim/sdk/blocks/agent.d.ts'))).toBe(true)
    expect(existsSync(join(outDir, '.sim/sdk/blocks/slack_v2.d.ts'))).toBe(true)
    expect(readFileSync(join(outDir, '.sim/sdk/workspace.d.ts'), 'utf8')).toContain("'docs': true")
    expect(readFileSync(join(outDir, 'AGENTS.md'), 'utf8')).toContain('apply')
    expect(callsTo(CATALOG_PATH)).toHaveLength(1)
    expect(callsTo(CATALOG_PATH)[0][1].query).toBeUndefined()
  })

  it('revalidates one cached catalog per workspace, whatever the output directory, and reuses it on 304', async () => {
    serve()
    await get('--out', outDir)
    request.mockReset()
    serve({
      [CATALOG_PATH]: () => {
        throw new SimApiError('Not modified', 304)
      },
    })
    const otherDir = join(rootDir, 'other')

    await get('--out', otherDir)

    expect(callsTo(CATALOG_PATH)[0][1].headers).toEqual({ 'if-none-match': `"${CATALOG.hash}"` })
    expect(existsSync(join(otherDir, '.sim/sdk/blocks/agent.d.ts'))).toBe(true)
  })

  it('fetches the workflow compile catalog when the workflow holds a type the workspace no longer offers', async () => {
    const compileCatalog = {
      ...CATALOG,
      blocks: { ...CATALOG.blocks, legacy_block: { ...CATALOG.blocks.note, type: 'legacy_block' } },
    }
    serve({
      [SOURCE_PATH]: () => source(undefined, ['agent', 'legacy_block']),
      [CATALOG_PATH]: () =>
        callsTo(CATALOG_PATH).length === 1 ? { data: CATALOG } : { data: compileCatalog },
    })

    await get('--out', outDir)

    expect(callsTo(CATALOG_PATH).map((call) => call[1].query)).toEqual([
      undefined,
      { workflowId: WORKFLOW_ID },
    ])
  })

  it('writes the source without workspace types when the manifest is refused', async () => {
    serve({
      [MANIFEST_PATH]: () => {
        throw new SimApiError('Forbidden', 403)
      },
    })

    await get('--out', outDir)

    expect(existsSync(join(outDir, 'workflow.ts'))).toBe(true)
    expect(existsSync(join(outDir, '.sim/sdk/workspace.d.ts'))).toBe(false)
  })

  it('surfaces a 304 when no cached catalog exists rather than writing without types', async () => {
    serve({
      [CATALOG_PATH]: () => {
        throw new SimApiError('Not modified', 304)
      },
    })

    await expect(get('--out', outDir)).rejects.toThrow('Not modified')
    expect(existsSync(join(outDir, 'workflow.ts'))).toBe(false)
  })

  it('refuses a file path that would escape the output directory, writing nothing', async () => {
    serve({ [SOURCE_PATH]: () => source({ '../escape.js': 'x' }) })

    await expect(get('--out', outDir)).rejects.toThrow('unsafe file path')
    expect(existsSync(join(rootDir, 'escape.js'))).toBe(false)
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('prints the response unchanged without --out', async () => {
    request.mockResolvedValue(source())

    await get('--annotate-ids')

    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.calls[0][1].query).toMatchObject({ annotateIds: true })
    expect(existsSync(join(outDir, 'workflow.ts'))).toBe(false)
  })
})
