import { describe, expect, it } from 'vitest'
import {
  buildModelCapabilityFacts,
  getEffectiveMaxOutputTokens,
  getModelBySlug,
  getPricingBounds,
  getProviderBySlug,
} from '@/app/(landing)/models/utils'

describe('model catalog capability facts', () => {
  it.concurrent(
    'shows structured outputs support and published max output tokens for gpt-4o',
    () => {
      const model = getModelBySlug('openai', 'gpt-4o')

      expect(model).not.toBeNull()
      expect(model).toBeDefined()

      const capabilityFacts = buildModelCapabilityFacts(model!)
      const structuredOutputs = capabilityFacts.find((fact) => fact.label === 'Structured outputs')
      const maxOutputTokens = capabilityFacts.find((fact) => fact.label === 'Max output tokens')

      expect(getEffectiveMaxOutputTokens(model!.capabilities)).toBe(16384)
      expect(structuredOutputs?.value).toBe('Supported')
      expect(maxOutputTokens?.value).toBe('16k')
    }
  )

  it.concurrent('preserves native structured outputs labeling for claude models', () => {
    const model = getModelBySlug('anthropic', 'claude-sonnet-4-6')

    expect(model).not.toBeNull()
    expect(model).toBeDefined()

    const capabilityFacts = buildModelCapabilityFacts(model!)
    const structuredOutputs = capabilityFacts.find((fact) => fact.label === 'Structured outputs')

    expect(structuredOutputs?.value).toBe('Supported (native)')
  })

  it.concurrent('does not invent a max output token limit when one is not published', () => {
    expect(getEffectiveMaxOutputTokens({})).toBeNull()
  })

  it.concurrent('keeps best-for copy for clearly differentiated models only', () => {
    const researchModel = getModelBySlug('google', 'deep-research-pro-preview-12-2025')
    const generalModel = getModelBySlug('mistral', 'mistral-medium-latest')

    expect(researchModel).not.toBeNull()
    expect(generalModel).not.toBeNull()

    expect(researchModel?.bestFor).toContain('research workflows')
    expect(generalModel?.bestFor).toBeUndefined()
  })

  it.concurrent('uses explicit catalog features for flagship provider cards', () => {
    expect(
      ['anthropic', 'openai', 'google'].map((providerId) => {
        const model = getProviderBySlug(providerId)?.featuredModels[0]
        return { providerId, modelId: model?.id, featured: model?.featured }
      })
    ).toEqual([
      { providerId: 'anthropic', modelId: 'claude-fable-5-1', featured: true },
      { providerId: 'openai', modelId: 'gpt-6-astra', featured: true },
      { providerId: 'google', modelId: 'gemini-3.8-flash', featured: true },
    ])

    expect(getProviderBySlug('anthropic')?.featuredModels[0]?.recommended).toBe(false)
  })

  it.concurrent('includes input-size tiers in structured pricing bounds', () => {
    const model = getModelBySlug('openai', 'gpt-6-astra')

    expect(model).not.toBeNull()
    expect(getPricingBounds(model!.pricing)).toEqual({ lowPrice: 1, highPrice: 75 })
  })
})
