import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SimApiError } from '../../http/client'
import { cacheCatalogText } from '../../test/catalog-cache'
import { contextMockFns, mockedProfile } from '../../test/context-mock'
import { attachWorkflowSourceParams } from './workflow-source-params'

vi.mock('../../context', async () => (await import('../../test/context-mock')).contextMock)

const WORKSPACE_ID = 'ws_params'
/** A real catalog projected from registry blocks, shared with the SDK's own type checks. */
const FIXTURE_TEXT = readFileSync(
  join(__dirname, '../../../../workflow-sdk/test/fixtures/catalog.json'),
  'utf8'
)

let dir: string

async function params(...argv: string[]): Promise<void> {
  const source = new Command('source')
  attachWorkflowSourceParams(source)
  source.commands.forEach((command) => command.exitOverride())
  await source.parseAsync(['node', 'source', 'params', ...argv, '--dir', dir])
}

function stdoutJson(): Record<string, unknown> {
  const calls = vi.mocked(console.log).mock.calls
  expect(calls).toHaveLength(1)
  return JSON.parse(calls[0].join(' '))
}

async function refusal(run: Promise<void>): Promise<SimApiError> {
  return (await run.then(
    () => {
      throw new Error('expected the command to refuse')
    },
    (error: unknown) => error
  )) as SimApiError
}

/** The fixture catalog under another hash, without the `table.upsertRow` builder. */
function catalogWithoutUpsert(): string {
  const catalog = JSON.parse(FIXTURE_TEXT)
  const { 'table.upsertRow': _removed, ...builders } = catalog.builders
  return JSON.stringify({ ...catalog, builders, hash: 'f'.repeat(64) })
}

function writeBase(catalogHash?: string): void {
  writeFileSync(
    join(dir, '.sim/base.json'),
    JSON.stringify({
      version: 1,
      workflowId: 'wf',
      workspaceId: WORKSPACE_ID,
      fingerprint: 'sf1:a',
      catalogHash,
    })
  )
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sim-source-params-'))
  mkdirSync(join(dir, '.sim'))
  vi.stubEnv('SIM_CONFIG_DIR', join(dir, 'config'))
  contextMockFns.mockProfileFrom.mockReturnValue({
    ...mockedProfile(),
    workspaceId: 'ws_other',
    output: 'json',
  })
  contextMockFns.mockRequest.mockReset()
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('sim workflows source params', () => {
  it("reads the catalog the directory was printed with, not the workspace's newer one", async () => {
    const printedWith = JSON.parse(FIXTURE_TEXT).hash as string
    cacheCatalogText(join(dir, 'config'), null, FIXTURE_TEXT)
    cacheCatalogText(join(dir, 'config'), WORKSPACE_ID, catalogWithoutUpsert())
    writeBase(printedWith)

    await params('table.upsertRow', '--full')

    const { builder } = stdoutJson() as {
      builder: { key: string; params: { common: Array<{ key: string; required: boolean }> } }
    }
    expect(builder.key).toBe('table.upsertRow')
    expect(builder.params.common.filter((param) => param.required).map((p) => p.key)).toEqual([
      'tableId',
      'data',
    ])
    expect(contextMockFns.mockRequest).not.toHaveBeenCalled()
  })

  it('reads an agent tool form as the builder it names', async () => {
    cacheCatalogText(join(dir, 'config'), WORKSPACE_ID, FIXTURE_TEXT)
    writeBase()

    await params('slack.tool.sendMessage')

    expect(stdoutJson()).toMatchObject({ builder: { key: 'slack.sendMessage' } })
  })

  it('reads a block type as the builder written for it', async () => {
    cacheCatalogText(join(dir, 'config'), WORKSPACE_ID, FIXTURE_TEXT)
    writeBase()

    await params('function')

    expect(stdoutJson()).toMatchObject({ builder: { key: 'fn', blockType: 'function' } })
  })

  it('lists the builders of a block type that has several', async () => {
    cacheCatalogText(join(dir, 'config'), WORKSPACE_ID, FIXTURE_TEXT)
    writeBase()

    await params('table_v2')

    const { kind, builders } = stdoutJson() as { kind: string; builders: Array<{ key: string }> }
    expect(kind).toBe('namespace')
    expect(builders.map((builder) => builder.key)).toContain('table.upsertRow')
  })

  it('refuses a builder the catalog lacks, naming the closest one', async () => {
    cacheCatalogText(join(dir, 'config'), WORKSPACE_ID, FIXTURE_TEXT)
    writeBase()

    const error = await refusal(params('slack.postMessage'))

    expect(error.code).toBe('BUILDER_UNKNOWN')
    expect(error.message).toContain('Did you mean slack.sendMessage?')
  })

  it('reads the catalog of the workspace a starter directory was written for', async () => {
    cacheCatalogText(join(dir, 'config'), WORKSPACE_ID, FIXTURE_TEXT)
    writeFileSync(join(dir, '.sim/starter.json'), JSON.stringify({ workspaceId: WORKSPACE_ID }))
    contextMockFns.mockProfileFrom.mockReturnValue({
      ...mockedProfile(),
      workspaceId: null,
      output: 'json',
    })

    await params('agent')

    expect(stdoutJson()).toMatchObject({ builder: { key: 'agent' } })
  })

  it('refuses without a cached catalog, making no request', async () => {
    writeBase()

    const error = await refusal(params('agent'))

    expect(error.code).toBe('CATALOG_NOT_CACHED')
    expect(contextMockFns.mockRequest).not.toHaveBeenCalled()
  })

  it('prints a brief builder by default and every param with its docs under --full', async () => {
    cacheCatalogText(join(dir, 'config'), WORKSPACE_ID, FIXTURE_TEXT)
    writeBase()

    await params('table.upsertRow')
    const brief = stdoutJson() as {
      builder: {
        required: Array<{ key: string; type: string }>
        optional: string[]
        outputs: string[]
      }
    }
    expect(brief.builder.required.map((param) => param.key)).toEqual(['tableId', 'data'])
    expect(brief.builder).not.toHaveProperty('params')
    expect(brief.builder.outputs.length).toBeGreaterThan(0)

    vi.mocked(console.log).mockClear()
    await params('table.upsertRow', '--full')
    const full = stdoutJson() as { builder: { params: { common: unknown[] } } }
    expect(full.builder.params.common.length).toBeGreaterThan(brief.builder.required.length)
    expect(JSON.stringify(full).length).toBeGreaterThan(JSON.stringify(brief).length * 2)
  })

  it('keeps the call signature of a builder whose required params core.d.ts types', async () => {
    cacheCatalogText(join(dir, 'config'), WORKSPACE_ID, FIXTURE_TEXT)
    writeBase()

    await params('fn')

    const { builder } = stdoutJson() as { builder: { coreParams: string[]; signature?: string } }
    expect(builder.coreParams).toContain('code')
    expect(builder.signature).toContain('code:')
  })

  it('names the builder that replaces a legacy block type, by either name', async () => {
    const catalog = JSON.parse(FIXTURE_TEXT)
    catalog.blocks.human_in_the_loop = {
      ...catalog.blocks.human_in_the_loop_v2,
      type: 'human_in_the_loop',
      lifecycle: { hidden: true, sunset: { status: 'legacy', replacedBy: 'human_in_the_loop_v2' } },
    }
    catalog.builders['legacy.humanInTheLoop'] = { type: 'human_in_the_loop' }
    cacheCatalogText(
      join(dir, 'config'),
      WORKSPACE_ID,
      JSON.stringify({ ...catalog, hash: 'e'.repeat(64) })
    )
    writeBase()

    await params('human_in_the_loop')

    expect(stdoutJson()).toMatchObject({
      builder: {
        key: 'legacy.humanInTheLoop',
        legacy: true,
        replacement: { blockType: 'human_in_the_loop_v2', builders: ['human'] },
      },
    })
  })

  it('names only the replacement builders for the same operation, and few of them', async () => {
    const catalog = JSON.parse(FIXTURE_TEXT)
    catalog.blocks.old_block = {
      ...catalog.blocks.human_in_the_loop_v2,
      type: 'old_block',
      lifecycle: { hidden: true, sunset: { status: 'legacy', replacedBy: 'new_block' } },
    }
    catalog.blocks.new_block = { ...catalog.blocks.human_in_the_loop_v2, type: 'new_block' }
    catalog.builders['legacy.old.send'] = { type: 'old_block', operation: 'send' }
    for (let index = 0; index < 20; index++) {
      catalog.builders[`next.op${index}`] = { type: 'new_block', operation: `op${index}` }
    }
    catalog.builders['next.send'] = { type: 'new_block', operation: 'send' }
    cacheCatalogText(
      join(dir, 'config'),
      WORKSPACE_ID,
      JSON.stringify({ ...catalog, hash: 'd'.repeat(64) })
    )
    writeBase()

    await params('legacy.old.send')

    const { builder } = stdoutJson() as { builder: { replacement: { builders: string[] } } }
    expect(builder.replacement.builders).toEqual(['next.send'])

    vi.mocked(console.log).mockClear()
    await params('legacy.old.send', '--full')
    expect(stdoutJson()).toMatchObject({ builder: { replacement: { builders: ['next.send'] } } })
  })
})
