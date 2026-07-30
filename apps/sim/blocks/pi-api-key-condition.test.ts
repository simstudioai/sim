/**
 * @vitest-environment node
 */
import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { evaluateSubBlockCondition } from '@/lib/workflows/subblocks/visibility'
import { PiBlock } from '@/blocks/blocks/pi'
import { getHostedModels } from '@/providers/utils'

const apiKeySubBlock = PiBlock.subBlocks.find((subBlock) => subBlock.id === 'apiKey')
const hostedModel = getHostedModels()[0]

function isApiKeyVisible(values: Record<string, unknown>): boolean {
  return evaluateSubBlockCondition(apiKeySubBlock?.condition, values)
}

describe('Pi API Key visibility', () => {
  beforeEach(() => {
    setEnvFlags({ isHosted: true })
  })

  afterEach(() => {
    setEnvFlags({ isHosted: false })
  })

  afterAll(resetEnvFlagsMock)

  it('exposes an apiKey subblock that is required when visible', () => {
    expect(apiKeySubBlock).toBeDefined()
    expect(apiKeySubBlock?.required).toBe(true)
  })

  // The bug this guards: the field used to hide for hosted models in every mode,
  // and Create PR then failed at execution demanding a BYOK key the user was
  // never asked for.
  it('shows the field in Create PR even for a model Sim hosts', () => {
    expect(hostedModel).toBeDefined()
    expect(isApiKeyVisible({ mode: 'cloud', model: hostedModel })).toBe(true)
  })

  it('shows the field in Create PR for a model Sim does not host', () => {
    expect(isApiKeyVisible({ mode: 'cloud', model: 'some-unhosted-model' })).toBe(true)
  })

  it.each([['local'], ['cloud_review']])(
    'hides the field in %s mode for a model Sim hosts',
    (mode) => {
      expect(isApiKeyVisible({ mode, model: hostedModel })).toBe(false)
    }
  )

  it.each([['local'], ['cloud_review']])(
    'shows the field in %s mode for a model Sim does not host',
    (mode) => {
      expect(isApiKeyVisible({ mode, model: 'some-unhosted-model' })).toBe(true)
    }
  )
})
