/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { imageGenerationInputSchema } from '@/lib/internal/image/schema'

const BASE_INPUT = {
  provider: 'openai',
  apiKey: 'key',
  prompt: 'Draw a landscape',
}

describe('image generation input', () => {
  it.each([null, '', '   '])('treats optional numeric sentinel %j as omitted', (sentinel) => {
    const parsed = imageGenerationInputSchema.parse({
      ...BASE_INPUT,
      numImages: sentinel,
      seed: sentinel,
    })

    expect(parsed.numImages).toBeUndefined()
    expect(parsed.seed).toBeUndefined()
  })

  it('preserves an explicit zero seed while rejecting zero images', () => {
    expect(imageGenerationInputSchema.parse({ ...BASE_INPUT, seed: 0 }).seed).toBe(0)
    expect(imageGenerationInputSchema.safeParse({ ...BASE_INPUT, numImages: 0 }).success).toBe(
      false
    )
  })

  it('rejects multiple OpenAI images because the tool contract returns one image', () => {
    expect(
      imageGenerationInputSchema.safeParse({ ...BASE_INPUT, numImages: 3 }).error?.issues
    ).toContainEqual(
      expect.objectContaining({
        path: ['numImages'],
        message: 'OpenAI image generation returns one image per tool execution',
      })
    )
    expect(
      imageGenerationInputSchema.safeParse({
        ...BASE_INPUT,
        provider: 'falai',
        numImages: 3,
      }).success
    ).toBe(true)
  })
})
