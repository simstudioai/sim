import { describe, expect, it } from 'vitest'
import { buildImageGenerationRequest } from '@/lib/internal/image/request'
import { imageGenerationInputSchema } from '@/lib/internal/image/schema'

function build(input: Record<string, unknown>) {
  return buildImageGenerationRequest(
    imageGenerationInputSchema.parse({ apiKey: 'key', prompt: 'draw a lighthouse', ...input })
  )
}

describe('image generation request', () => {
  it('sends a typed OpenAI model as is instead of a catalog fallback', () => {
    const request = build({ provider: 'openai', model: 'typed-model' })

    expect(request.endpoint).toBe('https://api.openai.com/v1/images/generations')
    expect(request.body).toEqual({ model: 'typed-model', prompt: 'draw a lighthouse', n: 1 })
  })

  it('sends a typed Gemini model to its own endpoint', () => {
    const request = build({ provider: 'gemini', model: 'typed-model' })

    expect(request.endpoint).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/typed-model:generateContent'
    )
  })

  it('resolves a padded catalog model to its catalog entry with its settings', () => {
    const request = build({ provider: 'openai', model: '  gpt-image-1.5  ', quality: 'high' })

    expect(request.model.label).not.toBe('gpt-image-1.5')
    expect(request.body).toMatchObject({ model: 'gpt-image-1.5', quality: 'high' })
  })

  it('keeps the retirement error for a padded retired model', () => {
    expect(() => build({ provider: 'openai', model: ' dall-e-3 ' })).toThrow(/retired/)
  })

  it('rejects settings on a typed model, which only sends the prompt', () => {
    expect(() => build({ provider: 'openai', model: 'typed-model', quality: 'high' })).toThrow(
      /Remove quality/
    )
  })
})
