/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { stripInteractiveCards } from '@/lib/knowledge/application/chat-citations'

describe('stripInteractiveCards', () => {
  it('removes a JSON card, including closing markers inside its strings', () => {
    expect(
      stripInteractiveCards('Answer <options>{"1":{"title":"Say </options> x"}}</options> end')
    ).toBe('Answer  end')
  })
  it('removes thinking blocks', () => {
    expect(stripInteractiveCards('<thinking>plan</thinking>Answer')).toBe('Answer')
  })
  it('keeps tag-shaped prose', () => {
    const prose = 'Wrap choices in <options>your list</options> tags, or use <question> to ask.'
    expect(stripInteractiveCards(prose)).toBe(prose)
  })
  it('drops a card left open before its JSON payload', () => {
    expect(stripInteractiveCards('Connect here <credential>{"type":"link"')).toBe('Connect here ')
  })
})
