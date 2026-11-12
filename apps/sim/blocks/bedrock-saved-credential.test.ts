import { describe, expect, it } from 'vitest'
import { AgentBlock } from '@/blocks/blocks/agent'
import { EvaluatorBlock } from '@/blocks/blocks/evaluator'
import { GuardrailsBlock } from '@/blocks/blocks/guardrails'
import { PiBlock } from '@/blocks/blocks/pi'
import { RouterBlock, RouterV2Block } from '@/blocks/blocks/router'
import { TranslateBlock } from '@/blocks/blocks/translate'
import type { BlockConfig } from '@/blocks/types'

const SAVED_CREDENTIAL_FIELDS = ['bedrockAuthMode', 'bedrockCredential', 'bedrockManualCredential']
const SAVED_CREDENTIAL_INPUTS = ['bedrockAuthMode', 'bedrockCredential']

/** The saved-credential fields and inputs a block publishes to the editor and the block catalog. */
function savedCredentialSurface(block: BlockConfig) {
  return {
    fields: block.subBlocks
      .map((subBlock) => subBlock.id)
      .filter((id) => SAVED_CREDENTIAL_FIELDS.includes(id)),
    inputs: Object.keys(block.inputs ?? {}).filter((key) => SAVED_CREDENTIAL_INPUTS.includes(key)),
  }
}

describe('Bedrock saved AWS credential surface', () => {
  // Guardrails never serializes its Bedrock fields and Pi has no Bedrock provider, so a
  // saved credential set on either would be dropped and the call signed some other way.
  it.each([
    ['guardrails', GuardrailsBlock],
    ['pi', PiBlock],
  ])('is absent from the %s block, which cannot forward a saved credential', (_, block) => {
    expect(savedCredentialSurface(block)).toEqual({ fields: [], inputs: [] })
  })

  it.each([
    ['agent', AgentBlock],
    ['router', RouterBlock],
    ['router_v2', RouterV2Block],
    ['evaluator', EvaluatorBlock],
    ['translate', TranslateBlock],
  ])('is offered by the %s block, which forwards it to the Bedrock call', (_, block) => {
    expect(savedCredentialSurface(block)).toEqual({
      fields: SAVED_CREDENTIAL_FIELDS,
      inputs: SAVED_CREDENTIAL_INPUTS,
    })
  })
})
