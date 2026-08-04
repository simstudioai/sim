/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  CUSTOM_MODEL_ID,
  isCustomModel,
  parseCustomModelConfig,
  redactCustomModelConfig,
} from '@/providers/custom-model'

describe('custom model config', () => {
  it('parses JSON and normalizes provider aliases', () => {
    expect(
      parseCustomModelConfig(
        JSON.stringify({
          provider: 'gemini',
          model: 'gemini-3.6-flash',
          parameters: { reasoningEffort: 'high', maxTokens: 8192 },
          credentials: { mode: 'explicit', apiKey: '{{GEMINI_API_KEY}}' },
          providerOptions: { mediaResolution: 'high' },
        })
      )
    ).toEqual({
      provider: 'google',
      model: 'gemini-3.6-flash',
      parameters: {
        reasoningEffort: 'high',
        verbosity: undefined,
        thinkingLevel: undefined,
        temperature: undefined,
        maxTokens: 8192,
        promptCaching: undefined,
      },
      credentials: { mode: 'explicit', apiKey: '{{GEMINI_API_KEY}}' },
      providerOptions: { mediaResolution: 'high' },
    })
  })

  it('accepts arbitrary reasoning levels for all supported providers', () => {
    for (const provider of ['openai', 'anthropic', 'google', 'fireworks', 'xai']) {
      expect(
        parseCustomModelConfig({
          provider,
          model: 'future-model',
          parameters: { reasoningEffort: 'vendor-future-level' },
        }).parameters.reasoningEffort
      ).toBe('vendor-future-level')
    }
  })

  it('rejects reserved provider option overrides', () => {
    expect(() =>
      parseCustomModelConfig({
        provider: 'openai',
        model: 'future-model',
        providerOptions: { tools: [{ type: 'web_search' }] },
      })
    ).toThrow('providerOptions.tools is controlled by Sim')
  })

  it('rejects unsupported canonical parameters instead of silently dropping them', () => {
    expect(() =>
      parseCustomModelConfig({
        provider: 'fireworks',
        model: 'accounts/acme/models/future',
        parameters: { verbosity: 'high' },
      })
    ).toThrow('verbosity is not supported for fireworks')

    expect(() =>
      parseCustomModelConfig({
        provider: 'xai',
        model: 'grok-future',
        parameters: { promptCaching: true },
      })
    ).toThrow('promptCaching is not supported for xai')
  })

  it('requires explicit credentials to carry a key', () => {
    expect(() =>
      parseCustomModelConfig({
        provider: 'anthropic',
        model: 'claude-future',
        credentials: { mode: 'explicit' },
      })
    ).toThrow('apiKey is required')
  })

  it('redacts literal credentials while preserving environment references', () => {
    const literal = redactCustomModelConfig({
      provider: 'openai',
      model: 'gpt-future',
      credentials: { mode: 'explicit', apiKey: 'sk-secret' },
    }) as any
    expect(literal.credentials.apiKey).toBe('<redacted>')

    const reference = redactCustomModelConfig(
      JSON.stringify({
        provider: 'openai',
        model: 'gpt-future',
        credentials: { mode: 'explicit', apiKey: '{{OPENAI_API_KEY}}' },
      })
    ) as string
    expect(reference).toContain('{{OPENAI_API_KEY}}')
  })

  it('recognizes the sentinel case-insensitively', () => {
    expect(isCustomModel(CUSTOM_MODEL_ID)).toBe(true)
    expect(isCustomModel('SIM-CUSTOM')).toBe(true)
    expect(isCustomModel('gpt-5.6-terra')).toBe(false)
  })
})
