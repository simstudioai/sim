import { describe, expect, it } from 'vitest'
import { SixtyfourBlock } from '@/blocks/blocks/sixtyfour'

/** Runs the mapper the way a tool call does: merged row and model args under the mapper's result. */
function resolveToolCall(args: Record<string, unknown>, operation: string) {
  const mapper = SixtyfourBlock.tools.config?.params
  if (!mapper) throw new Error('Sixtyfour block has no params mapper')
  return { ...args, ...mapper(args, { operation }) }
}

describe('SixtyfourBlock agent tool calls', () => {
  it('maps the struct saved on the tool row when the operation arrives only in context', () => {
    const struct = { website: 'Company website' }
    const result = resolveToolCall(
      { targetCompany: { name: 'Acme' }, companyStruct: struct },
      'enrich_company'
    )

    expect(result.struct).toEqual(struct)
  })

  it('keeps the struct the model sends under the tool param name', () => {
    const struct = { title: 'Job title' }
    const result = resolveToolCall({ leadInfo: { name: 'Ada' }, struct }, 'enrich_lead')

    expect(result.struct).toEqual(struct)
  })
})
