import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
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
