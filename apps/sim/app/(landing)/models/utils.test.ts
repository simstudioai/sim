import { describe, expect, it } from 'vitest'
import { buildModelCapabilityFacts, getEffectiveMaxOutputTokens, getModelBySlug } from './utils'

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
    const generalModel = getModelBySlug('xai', 'grok-4-latest')

    expect(researchModel).not.toBeNull()
    expect(generalModel).not.toBeNull()

    expect(researchModel?.bestFor).toContain('research workflows')
    expect(generalModel?.bestFor).toBeUndefined()
  })
})
