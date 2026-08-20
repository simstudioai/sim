/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Invariants of the projection layer that no schema can express.
 *
 * Each one has been a real defect: a projection handing out the registry's own
 * arrays, a hosted-key answer that ignored the deployment, an options function
 * that could leave a process-global store stubbed, and a routine registry shape
 * logged as a warning on every sweep.
 */
const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@sim/logger', () => ({
  createLogger: () => mockLogger,
  logger: mockLogger,
  runWithRequestContext: <T>(_ctx: unknown, fn: () => T): T => fn(),
  getRequestContext: () => undefined,
  setRequestTraceId: () => undefined,
}))

vi.mock('@/tools/metadata', () => ({
  getToolMetadata: (toolId: string) =>
    toolId === 'hosted_tool'
      ? { id: 'hosted_tool', name: 'Hosted', description: 'Hosted.', hostedApiKey: 'always' }
      : undefined,
}))
vi.mock('@/tools/metadata-outputs', () => ({ getToolOutputsMetadata: () => ({}) }))
vi.mock('@/tools/tool-ids', () => ({ resolveToolId: (toolId: string) => toolId }))
vi.mock('@/blocks/registry', () => ({ getBlockMeta: () => ({ tags: ['messaging'] }) }))

import { projectBlockTriggers } from '@/lib/catalog/projection/block-detail'
import { projectBlockSummary } from '@/lib/catalog/projection/block-summary'
import { projectConnectorType } from '@/lib/catalog/projection/connector-type'
import {
  AsyncOptionsFunctionError,
  projectSubBlock,
  resolveSubBlockOptions,
} from '@/lib/catalog/projection/subblock'
import { projectToolDetail } from '@/lib/catalog/projection/tool'
import type { BlockConfig, SubBlockConfig } from '@/blocks/types'
import type { ConnectorMeta } from '@/connectors/types'

function block(overrides: Partial<BlockConfig> & { type: string }): BlockConfig {
  return {
    name: overrides.type,
    description: 'A block.',
    category: 'tools',
    bgColor: '#000000',
    icon: (() => null) as unknown as BlockConfig['icon'],
    subBlocks: [],
    tools: { access: [] },
    inputs: {},
    outputs: {},
    ...overrides,
  } as BlockConfig
}

describe('hosted-key answers follow the deployment', () => {
  it('publishes a declared hosted key on a hosted deployment', () => {
    expect(projectToolDetail('hosted_tool', { hostedKeys: true })?.hostedApiKey).toBe('always')
  })

  /**
   * `injectHostedKeyIfNeeded` returns early on `!isHosted`, so a self-hosted
   * deployment supplies no key at all. Reporting `always` there tells a caller
   * they need no key of their own when they do.
   */
  it('reports none where the deployment supplies no hosted keys', () => {
    expect(projectToolDetail('hosted_tool', { hostedKeys: false })?.hostedApiKey).toBe('none')
  })
})

describe('projections never hand out registry state', () => {
  it('copies the arrays a block summary publishes', () => {
    const config = block({
      type: 'slack',
      triggers: { enabled: true, available: ['slack_webhook'] },
      tools: { access: ['slack_message'] },
    })

    const summary = projectBlockSummary(config)
    summary.triggerIds.push('injected')
    summary.toolIds.push('injected')
    summary.tags.push('injected')

    expect(config.triggers?.available).toEqual(['slack_webhook'])
    expect(config.tools?.access).toEqual(['slack_message'])
  })

  it('copies the arrays a sub-block publishes', () => {
    const subBlock: SubBlockConfig = {
      id: 'files',
      type: 'file-upload',
      requiredScopes: ['drive.readonly'],
      columns: ['name'],
      dependsOn: ['folderId'],
    }

    const projected = projectSubBlock(subBlock)
    ;(projected.requiredScopes as string[]).push('injected')
    ;(projected.columns as string[]).push('injected')
    ;(projected.dependsOn as string[]).push('injected')

    expect(subBlock.requiredScopes).toEqual(['drive.readonly'])
    expect(subBlock.columns).toEqual(['name'])
    expect(subBlock.dependsOn).toEqual(['folderId'])
  })

  it('copies a connector config field’s dependsOn, in both of its shapes', () => {
    const meta = {
      name: 'Drive',
      description: 'Sync Drive.',
      auth: { type: 'oauth', providerId: 'google-drive', scopes: ['drive.readonly'] },
      configFields: [
        { id: 'folderId', title: 'Folder', type: 'text', dependsOn: ['accountId'] },
        { id: 'fileId', title: 'File', type: 'text', dependsOn: { all: ['folderId'] } },
      ],
      supportsIncrementalSync: true,
      tagDefinitions: [],
    } as unknown as ConnectorMeta

    const projected = projectConnectorType('google_drive', meta)
    ;(projected.configFields[0].dependsOn as string[]).push('injected')
    ;((projected.configFields[1].dependsOn as { all: string[] }).all as string[]).push('injected')

    expect(meta.configFields[0].dependsOn).toEqual(['accountId'])
    expect(meta.configFields[1].dependsOn).toEqual({ all: ['folderId'] })
  })
})

describe('options functions must be synchronous', () => {
  /**
   * The providers store is substituted process-wide for the duration of the
   * call, so an asynchronous options function would expose its substitute state
   * to every other caller. It fails loudly rather than degrading to no options.
   */
  it('throws rather than swallowing a thenable result', () => {
    const subBlock = {
      id: 'model',
      type: 'combobox',
      options: () => Promise.resolve([{ id: 'gpt', label: 'gpt' }]),
    } as unknown as SubBlockConfig

    expect(() => resolveSubBlockOptions(subBlock)).toThrow(AsyncOptionsFunctionError)
  })

  it('still degrades an ordinary options failure to no options', () => {
    const subBlock = {
      id: 'model',
      type: 'combobox',
      options: () => {
        throw new Error('no store here')
      },
    } as unknown as SubBlockConfig

    expect(resolveSubBlockOptions(subBlock)).toBeUndefined()
  })
})

describe('trigger kinds with no registered definition', () => {
  beforeEach(() => {
    mockLogger.warn.mockClear()
    mockLogger.debug.mockClear()
  })

  /**
   * `start_trigger` names `chat`, `manual` and `api` — entry-point kinds, not
   * registered trigger definitions. That is the shape of every core trigger
   * block, so at `warn` the real registry emitted seven warnings per sweep.
   */
  it('logs at debug, not warn', () => {
    const triggers = projectBlockTriggers(
      block({ type: 'start_trigger', triggers: { enabled: true, available: ['chat', 'manual'] } })
    )

    expect(triggers).toEqual([])
    expect(mockLogger.warn).not.toHaveBeenCalled()
    expect(mockLogger.debug).toHaveBeenCalledTimes(2)
  })
})
