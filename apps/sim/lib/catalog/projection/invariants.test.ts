import { describe, expect, it, vi } from 'vitest'

/**
 * Invariants of the projection layer that no schema can express.
 *
 * Each one has been a real defect: a projection handing out the registry's own
 * arrays, a hosted-key answer that ignored the deployment, an options function
 * that could leave a process-global store stubbed, and a routine registry shape
 * logged as a warning on every sweep.
 */
vi.mock('@/tools/tool-ids', () => ({ resolveToolId: (toolId: string) => toolId }))

import { projectBlockSummary } from '@/lib/catalog/projection/block-summary'
import {
  AsyncOptionsFunctionError,
  projectSubBlock,
  resolveSubBlockOptions,
} from '@/lib/catalog/projection/subblock'
import { getBlockMeta } from '@/blocks/registry'
import type { BlockConfig, SubBlockConfig } from '@/blocks/types'
import { getToolMetadata } from '@/tools/metadata'
import { getToolOutputsMetadata } from '@/tools/metadata-outputs'

vi.mocked(getToolMetadata).mockImplementation((toolId: string) =>
  toolId === 'hosted_tool'
    ? ({
        id: 'hosted_tool',
        name: 'Hosted',
        description: 'Hosted.',
        hostedApiKey: 'always',
      } as unknown as ReturnType<typeof getToolMetadata>)
    : undefined
)
vi.mocked(getToolOutputsMetadata).mockReturnValue({})
vi.mocked(getBlockMeta).mockReturnValue({ tags: ['messaging'] } as unknown as ReturnType<
  typeof getBlockMeta
>)

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
})

describe('conditional requirement is published as a condition, not as required', () => {
  const field = (overrides: Partial<SubBlockConfig>): SubBlockConfig =>
    ({ id: 'apiKey', type: 'short-input', ...overrides }) as SubBlockConfig

  it('reports a required field gated by a non-operation condition as optional with requiredWhen', () => {
    const projected = projectSubBlock(
      field({ required: true, condition: { field: 'model', value: ['gpt-4o'], not: true } })
    )

    expect(projected.required).toBe(false)
    expect(projected.requiredWhen).toEqual({ field: 'model', value: ['gpt-4o'], not: true })
    expect(projected.condition).toEqual({ field: 'model', value: ['gpt-4o'], not: true })
  })

  it('resolves a condition-shaped required to optional plus the clause', () => {
    const projected = projectSubBlock(
      field({ required: () => ({ field: 'memoryType', value: 'conversation' }) })
    )

    expect(projected.required).toBe(false)
    expect(projected.requiredWhen).toEqual({ field: 'memoryType', value: 'conversation' })
  })
})

describe('model picker options', () => {
  it('marks hosted models on a resolved option list and leaves other pickers alone', () => {
    const model = projectSubBlock({
      id: 'model',
      type: 'combobox',
      options: () => [{ id: 'gpt-4o', label: 'gpt-4o' }, { id: 'my-local-model' }],
    } as unknown as SubBlockConfig)
    expect(model.options).toEqual([
      { id: 'gpt-4o', label: 'gpt-4o', hosted: true },
      { id: 'my-local-model' },
    ])

    const other = projectSubBlock({
      id: 'voice',
      type: 'dropdown',
      options: [{ id: 'gpt-4o', label: 'gpt-4o' }],
    } as unknown as SubBlockConfig)
    expect(other.options).toEqual([{ id: 'gpt-4o', label: 'gpt-4o' }])
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
})
