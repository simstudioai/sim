import { setEnv } from '@sim/testing/mocks/env.mock'
import { envFlagsMockFns, resetEnvFlagsMock, setEnvFlags } from '@sim/testing/mocks/env-flags.mock'
import type { Mock } from 'vitest'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { validateInputsForBlock } from '@/lib/workflows/editing/validation'
import { AgentBlock } from '@/blocks/blocks/agent'
import { EvaluatorBlock } from '@/blocks/blocks/evaluator'
import { GuardrailsBlock } from '@/blocks/blocks/guardrails'
import { RouterV2Block } from '@/blocks/blocks/router'
import { TranslateBlock } from '@/blocks/blocks/translate'
import { getBlock } from '@/blocks/registry'

/**
 * The model field of the real model blocks through the real validator: which values each
 * block's option source lets an edit write. The registry is mocked globally (vitest.setup),
 * so it is pointed at the real block configs here.
 */
const BLOCKS: Record<string, unknown> = {
  agent: AgentBlock,
  router_v2: RouterV2Block,
  evaluator: EvaluatorBlock,
  translate: TranslateBlock,
  guardrails: GuardrailsBlock,
}

function validateModel(blockType: string, model: string) {
  const result = validateInputsForBlock(blockType, { model }, `${blockType}-1`)
  return { errors: result.errors, model: result.validInputs.model }
}

afterAll(resetEnvFlagsMock)

beforeEach(() => {
  ;(getBlock as Mock).mockImplementation((type: string) => BLOCKS[type])
})

afterEach(() => {
  setEnvFlags({ isHosted: false })
  setEnv({ OLLAMA_URL: undefined })
  envFlagsMockFns.getBlacklistedProvidersFromEnv.mockReset().mockImplementation(() => [])
})

describe('agent model field', () => {
  it.each(['<start.model>', '{{MODEL_ID}}', 'llama3.1:8b', 'sim-auto', 'ft:gpt-4o:org::abc'])(
    'passes %s through unchanged, as it always has',
    (model) => {
      setEnvFlags({ isHosted: true })
      expect(validateModel('agent', model)).toEqual({ errors: [], model })
    }
  )
})

describe('router and evaluator model fields', () => {
  it.each(['router_v2', 'evaluator'])('accepts a reference on %s', (blockType) => {
    expect(validateModel(blockType, '<start.model>')).toEqual({
      errors: [],
      model: '<start.model>',
    })
    expect(validateModel(blockType, '{{MODEL_ID}}')).toEqual({ errors: [], model: '{{MODEL_ID}}' })
  })

  it.each(['router_v2', 'evaluator'])(
    'accepts sim-auto on %s on hosted Sim, where the model router resolves it',
    (blockType) => {
      setEnvFlags({ isHosted: true })
      expect(validateModel(blockType, ' Sim-Auto ')).toEqual({ errors: [], model: 'sim-auto' })
    }
  )

  it('rejects sim-auto on self-hosted Sim, where Auto is never offered', () => {
    const { errors, model } = validateModel('router_v2', 'sim-auto')
    expect(model).toBeUndefined()
    expect(errors[0]?.error).toContain('Unknown model id')
  })
})

describe('translate and guardrails model fields', () => {
  it.each(['translate', 'guardrails'])(
    'rejects sim-auto on %s, which sends its model straight to the provider',
    (blockType) => {
      setEnvFlags({ isHosted: true })
      const { errors, model } = validateModel(blockType, 'sim-auto')
      expect(model).toBeUndefined()
      expect(errors[0]?.error).toContain('Unknown model id')
    }
  )
})

describe('model ids no provider declares', () => {
  const CATALOG_BLOCKS = ['router_v2', 'evaluator', 'translate', 'guardrails']

  it.each(CATALOG_BLOCKS)(
    'accepts an installed Ollama model on %s where Ollama is reachable',
    (blockType) => {
      expect(validateModel(blockType, 'llama3.1:8b')).toEqual({ errors: [], model: 'llama3.1:8b' })
      setEnvFlags({ isHosted: true })
      setEnv({ OLLAMA_URL: 'http://ollama.internal:11434' })
      expect(validateModel(blockType, 'qwen3:latest')).toEqual({
        errors: [],
        model: 'qwen3:latest',
      })
    }
  )

  it.each(CATALOG_BLOCKS)('rejects it on %s on hosted Sim with no Ollama', (blockType) => {
    setEnvFlags({ isHosted: true })
    const { errors, model } = validateModel(blockType, 'llama3.1:8b')
    expect(model).toBeUndefined()
    expect(errors[0]?.error).toContain('Unknown model id')
  })

  it.each(['gpt-oss:20b', 'mistral:latest'])(
    'accepts %s, an installed Ollama model sharing a cloud prefix, where it runs on Ollama',
    (model) => {
      expect(validateModel('router_v2', model)).toEqual({ errors: [], model })
      setEnvFlags({ isHosted: true })
      expect(validateModel('router_v2', model).errors[0]?.error).toContain('Unknown model id')
    }
  )

  it.each(['hhao/qwen2.5-coder-tools', 'hf.co/bartowski/Llama-3.2-1B-Instruct-GGUF:Q4_K_M'])(
    'accepts a namespaced Ollama library name such as %s',
    (model) => {
      expect(validateModel('router_v2', model)).toEqual({ errors: [], model })
    }
  )

  it.each(['best available model', 'llama3.1:8b:extra', 'model/'])(
    'still rejects %s, which is not an Ollama model name',
    (model) => {
      const { errors } = validateModel('router_v2', model)
      expect(errors[0]?.error).toContain('Unknown model id')
    }
  )

  it.each(['claude-sonnet-4.6', 'groq/'])(
    'still rejects %s, which a provider claims, so it never reaches Ollama',
    (model) => {
      const { errors } = validateModel('router_v2', model)
      expect(errors[0]?.error).toContain('Unknown model id')
    }
  )

  it('rejects it when the Ollama provider is blacklisted', () => {
    envFlagsMockFns.getBlacklistedProvidersFromEnv.mockReturnValue(['ollama'])
    const { errors } = validateModel('router_v2', 'llama3.1:8b')
    expect(errors[0]?.error).toContain('Unknown model id')
  })

  it('offers an ollama/ namespace example only where Ollama can serve it', () => {
    expect(validateModel('router_v2', 'best available model').errors[0]?.error).toContain(
      '"ollama/llama3.1:8b"'
    )

    setEnvFlags({ isHosted: true })
    expect(validateModel('router_v2', 'best available model').errors[0]?.error).not.toContain(
      'ollama/'
    )

    setEnvFlags({ isHosted: false })
    envFlagsMockFns.getBlacklistedProvidersFromEnv.mockReturnValue(['ollama'])
    expect(validateModel('router_v2', 'best available model').errors[0]?.error).not.toContain(
      'ollama/'
    )
  })
})

describe('fallback model rows', () => {
  function validateFallback(blockType: string, model: string) {
    const result = validateInputsForBlock(
      blockType,
      { fallbackModels: [{ id: 'row-1', model }] },
      `${blockType}-1`
    )
    return { errors: result.errors, rows: result.validInputs.fallbackModels }
  }

  it.each(['agent', 'router_v2', 'evaluator'])(
    'accepts an installed Ollama model on %s where Ollama is reachable, as the model field does',
    (blockType) => {
      const { errors, rows } = validateFallback(blockType, 'mistral:latest')
      expect(errors).toEqual([])
      expect(rows).toEqual([expect.objectContaining({ model: 'mistral:latest' })])
    }
  )

  it('rejects it on hosted Sim with no Ollama', () => {
    setEnvFlags({ isHosted: true })
    const { errors } = validateFallback('agent', 'mistral:latest')
    expect(errors[0]?.error).toContain('unknown model id "mistral:latest"')
  })

  it('rejects it when the Ollama provider is blacklisted', () => {
    envFlagsMockFns.getBlacklistedProvidersFromEnv.mockReturnValue(['ollama'])
    const { errors } = validateFallback('agent', 'mistral:latest')
    expect(errors[0]?.error).toContain('unknown model id "mistral:latest"')
  })

  it('still rejects sim-auto and free text', () => {
    expect(validateFallback('agent', 'sim-auto').errors[0]?.error).toContain('sim-auto')
    expect(validateFallback('agent', 'best available model').errors[0]?.error).toContain(
      'unknown model id'
    )
  })
})
