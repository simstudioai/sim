import { describe, expect, it } from 'vitest'
import { ResendV2Block } from '@/blocks/blocks/resend'
import type { BlockToolParamsContext } from '@/blocks/types'

function mapParams(params: Record<string, unknown>, context?: BlockToolParamsContext) {
  const mapper = ResendV2Block.tools.config?.params
  if (!mapper) throw new Error('Resend block has no params mapper')
  return mapper(params, context)
}

describe('Resend contact subscription status', () => {
  it.each([true, false])('keeps a model-sent boolean unsubscribed=%s on a tool call', (value) => {
    expect(
      mapParams(
        { contactId: 'jane@example.com', unsubscribed: value },
        { operation: 'update_contact' }
      ).unsubscribed
    ).toBe(value)
  })

  it.each([
    ['true', true],
    ['false', false],
    ['', undefined],
  ])('maps the canvas dropdown value %j to %j', (value, expected) => {
    expect(
      mapParams({ operation: 'create_contact', email: 'a@example.com', unsubscribed: value })
        .unsubscribed
    ).toBe(expected)
  })
})

describe('Resend list pagination limit', () => {
  it('keeps a model-sent numeric limit on a tool call', () => {
    expect(mapParams({ limit: 50 }, { operation: 'list_contacts' }).limit).toBe(50)
  })

  it('turns the canvas text limit into a number and drops a blank one', () => {
    expect(mapParams({ operation: 'list_domains', limit: ' 75 ' }).limit).toBe(75)
    expect(mapParams({ operation: 'list_domains', limit: '' }).limit).toBeUndefined()
  })
})
