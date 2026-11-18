import { describe, expect, it } from 'vitest'
import { HuggingFaceBlock } from '@/blocks/blocks/huggingface'

function chatParams(temperature: unknown) {
  const mapParams = HuggingFaceBlock.tools.config?.params
  if (!mapParams) throw new Error('Hugging Face block has no params mapper')
  return mapParams({ apiKey: 'k', provider: 'p', model: 'm', content: 'hi', temperature })
}

describe('HuggingFaceBlock temperature', () => {
  it('sends the same temperature for the stored text and number forms', () => {
    for (const [text, number] of [
      ['0.7', 0.7],
      ['0', 0],
    ] as const) {
      expect(chatParams(text).temperature).toBe(number)
      expect(chatParams(number).temperature).toBe(number)
    }
  })

  it('leaves a blank temperature unset', () => {
    expect(chatParams('').temperature).toBeUndefined()
  })
})
