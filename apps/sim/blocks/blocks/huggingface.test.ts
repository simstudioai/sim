import { describe, expect, it } from 'vitest'
import { HuggingFaceBlock } from '@/blocks/blocks/huggingface'

describe('Hugging Face block params', () => {
  it('sends a temperature of 0 instead of dropping it', () => {
    const mapper = HuggingFaceBlock.tools.config?.params
    if (!mapper) throw new Error('Hugging Face block has no params mapper')

    const result = mapper({
      apiKey: 'hf_test',
      provider: 'novita',
      model: 'org/model',
      content: 'hi',
      temperature: 0,
    })

    expect(result.temperature).toBe(0)
  })
})
