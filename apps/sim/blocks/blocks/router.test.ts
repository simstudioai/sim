import { describe, expect, it } from 'vitest'
import { RouterBlock, RouterV2Block } from '@/blocks/blocks/router'
import type { BlockConfig } from '@/blocks/types'
import { CUSTOM_MODEL_ID } from '@/providers/custom-model'

describe.each([
  ['legacy Router', RouterBlock],
  ['Router V2', RouterV2Block],
] as const)('%s custom model configuration', (_label, block: BlockConfig) => {
  it('exposes the Super User custom option and JSON configuration', () => {
    const modelIndex = block.subBlocks.findIndex((subBlock) => subBlock.id === 'model')
    const modelOptions = block.subBlocks[modelIndex].options
    const evaluatedModelOptions = typeof modelOptions === 'function' ? modelOptions() : modelOptions

    expect(evaluatedModelOptions).toContainEqual(
      expect.objectContaining({ id: CUSTOM_MODEL_ID, requiresSuperUser: true })
    )
    expect(block.subBlocks[modelIndex + 1]).toEqual(
      expect.objectContaining({
        id: 'customModelConfig',
        type: 'code',
        language: 'json',
        superUserOnly: true,
        condition: { field: 'model', value: CUSTOM_MODEL_ID },
        required: { field: 'model', value: CUSTOM_MODEL_ID },
      })
    )
    expect(block.inputs.customModelConfig?.schema?.properties.provider.enum).toContain('sim')
  })

  it('serializes the provider selected by the custom configuration', () => {
    expect(
      block.tools.config?.tool?.({
        model: CUSTOM_MODEL_ID,
        customModelConfig: {
          provider: 'fireworks',
          model: 'accounts/fireworks/models/kimi-k3',
        },
      } as never)
    ).toBe('fireworks')
  })

  it('serializes custom Sim Auto with the fallback provider shape', () => {
    expect(
      block.tools.config?.tool?.({
        model: CUSTOM_MODEL_ID,
        customModelConfig: {
          provider: 'sim',
          model: 'sim-auto',
        },
      } as never)
    ).toBe('anthropic')
  })
})
