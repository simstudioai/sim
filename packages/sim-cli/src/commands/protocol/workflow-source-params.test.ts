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

    await params('table.upsertRow')

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

  it('refuses without a cached catalog, making no request', async () => {
    writeBase()

    const error = await refusal(params('agent'))

    expect(error.code).toBe('CATALOG_NOT_CACHED')
    expect(contextMockFns.mockRequest).not.toHaveBeenCalled()
  })
})
