/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  CUSTOM_MODEL_CONFIG_JSON_SCHEMA,
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

  it('normalizes documented Fireworks resource ids to their JSON catalog aliases', () => {
    expect(
      parseCustomModelConfig({
        provider: 'fireworks',
        model: 'accounts/fireworks/models/minimax-m2p7',
        credentials: { mode: 'explicit', apiKey: '{{FIREWORKS_API_KEY}}' },
      }).model
    ).toBe('fireworks/minimax-m2.7')

    expect(
      parseCustomModelConfig({
        provider: 'fireworks',
        model: 'nvidia-nemotron-3-super-120b-a12b-fp8',
        deployment: 'accounts/acme/deployments/nemotron-super-fp8',
        credentials: { mode: 'explicit', apiKey: '{{FIREWORKS_API_KEY}}' },
      }).model
    ).toBe('fireworks/nemotron-3-super-120b-a12b-fp8')

    expect(parseCustomModelConfig({ provider: 'fireworks', model: 'deepseek-v4-pro' }).model).toBe(
      'fireworks/deepseek-v4-pro'
    )
  })

  it('requires an explicit key for Fireworks on-demand models', () => {
    expect(() =>
      parseCustomModelConfig({
        provider: 'fireworks',
        model: 'fireworks/qwen3.7-max',
        credentials: { mode: 'auto' },
      })
    ).toThrow('credentials.mode must be "explicit"')
  })

  it('requires a valid deployment resource for Fireworks on-demand models', () => {
    const base = {
      provider: 'fireworks',
      model: 'fireworks/qwen3.7-max',
      credentials: { mode: 'explicit', apiKey: '{{FIREWORKS_API_KEY}}' },
    }

    expect(() => parseCustomModelConfig(base)).toThrow('deployment is required')
    expect(() => parseCustomModelConfig({ ...base, deployment: 'qwen-prod' })).toThrow(
      'must match accounts/<account-id>/deployments/<deployment-id>'
    )
    expect(
      parseCustomModelConfig({
        ...base,
        deployment: 'accounts/acme/deployments/qwen-prod',
      })
    ).toMatchObject({
      model: 'fireworks/qwen3.7-max',
      deployment: 'accounts/acme/deployments/qwen-prod',
    })
  })

  it('accepts Fireworks priority only for catalog models with a documented priority rate', () => {
    expect(
      parseCustomModelConfig({
        provider: 'fireworks',
        model: 'fireworks/minimax-m2.7',
        providerOptions: { service_tier: 'priority' },
      }).providerOptions
    ).toEqual({ service_tier: 'priority' })

    expect(() =>
      parseCustomModelConfig({
        provider: 'fireworks',
        model: 'fireworks/nemotron-3-ultra-nvfp4',
        providerOptions: { service_tier: 'priority' },
      })
    ).toThrow('priority processing is unavailable')
  })

  it('includes every requested Fireworks model and xAI Grok 4.5 in the JSON schema', () => {
    expect(CUSTOM_MODEL_CONFIG_JSON_SCHEMA.properties.model.examples).toEqual(
      expect.arrayContaining([
        'fireworks/minimax-m2.7',
        'fireworks/qwen3.7-max',
        'fireworks/gpt-oss-120b',
        'fireworks/nemotron-3-ultra-nvfp4',
        'fireworks/nemotron-3-ultra-bf16',
        'fireworks/nemotron-3-super-120b-a12b-nvfp4',
        'fireworks/nemotron-3-super-120b-a12b-fp8',
        'fireworks/ling-3-flash',
        'grok-4.5',
      ])
    )
    expect(CUSTOM_MODEL_CONFIG_JSON_SCHEMA.examples).toEqual(
      expect.arrayContaining([expect.objectContaining({ provider: 'xai', model: 'grok-4.5' })])
    )
  })

  it('supports Sim Auto through the custom contract', () => {
    expect(
      parseCustomModelConfig({
        provider: 'auto',
        model: 'sim-auto',
        parameters: { reasoningEffort: 'high', temperature: 0.2 },
        credentials: { mode: 'auto' },
      })
    ).toMatchObject({
      provider: 'sim',
      model: 'sim-auto',
      parameters: { reasoningEffort: 'high', temperature: 0.2 },
      credentials: { mode: 'auto' },
    })
  })

  it('keeps Sim Auto provider-independent', () => {
    expect(() =>
      parseCustomModelConfig({
        provider: 'sim',
        model: 'gpt-5.6-terra',
      })
    ).toThrow('model must be "sim-auto"')

    expect(() =>
      parseCustomModelConfig({
        provider: 'sim',
        model: 'sim-auto',
        credentials: { mode: 'explicit', apiKey: 'sk-secret' },
      })
    ).toThrow('credentials.mode must be "auto"')

    expect(() =>
      parseCustomModelConfig({
        provider: 'sim',
        model: 'sim-auto',
        providerOptions: { service_tier: 'priority' },
      })
    ).toThrow('providerOptions must be empty for Sim Auto')
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
