/** @vitest-environment node */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/tokenization/accurate', () => ({
  getAccurateTokenCount: (value: string) => value.length,
}))
vi.mock('@/providers/models', () => ({
  PROVIDER_DEFINITIONS: { test: { models: [{ id: 'small', contextWindow: 100 }] } },
}))

import {
  markConversationExchangeGroup,
  selectConversationContextWindow,
  selectConversationMessageWindow,
  selectConversationTokenWindow,
} from '@/lib/memory/history-window'
import type { Message } from '@/providers/types'

const user: Message[] = [{ role: 'user', content: 'question' }]
const final: Message[] = [{ role: 'assistant', content: 'answer' }]

function exchange(id: string): Message[] {
  return [
    {
      role: 'assistant',
      content: null,
      tool_calls: [
        { id, type: 'function', function: { name: 'lookup', arguments: '{"query":"test"}' } },
        { id: `${id}-parallel`, type: 'function', function: { name: 'lookup', arguments: '{}' } },
      ],
    },
    { role: 'tool', tool_call_id: id, content: 'result' },
    { role: 'tool', tool_call_id: `${id}-parallel`, content: 'parallel result' },
  ]
}

describe('conversation history windows', () => {
  it('does not charge internal tool events against conversational message slots', () => {
    const groups = [user, exchange('first'), exchange('second'), final]
    expect(selectConversationMessageWindow(groups.flat(), 2, groups)).toEqual(groups.flat())
    expect(selectConversationMessageWindow(groups.flat(), 1, groups)).toEqual(final)
  })

  it('keeps completed exchanges from failed turns with their preceding input', () => {
    const groups = [final, user, exchange('first'), exchange('second')]
    expect(selectConversationMessageWindow(groups.flat(), 1, groups)).toEqual(
      groups.slice(1).flat()
    )
  })

  it('keeps portable execution receipts in the same zero-slot exchange category', () => {
    const receipt: Message[] = [{ role: 'user', content: 'bounded untrusted execution receipt' }]
    markConversationExchangeGroup(receipt)
    const groups = [user, receipt, final]
    expect(selectConversationMessageWindow(groups.flat(), 2, groups)).toEqual(groups.flat())
  })

  it('preserves legacy plain-message window semantics', () => {
    expect(selectConversationMessageWindow([...user, ...final], 1)).toEqual(final)
    expect(selectConversationTokenWindow([...user, ...final], 6)).toEqual(final)
  })

  it('budgets call arguments and never retains half a parallel batch', () => {
    const groups = [user, exchange('batch'), final]
    expect(selectConversationTokenWindow(groups.flat(), 80, undefined, groups)).toEqual(final)
    const pending = groups.slice(0, -1)
    expect(selectConversationTokenWindow(pending.flat(), 1, undefined, pending)).toEqual(groups[1])
  })

  it('applies model context bounds to complete groups', () => {
    const groups = [user, exchange('batch'), final]
    expect(selectConversationContextWindow(groups.flat(), 'small', groups)).toEqual(final)
    expect(selectConversationContextWindow(groups.flat(), 'unknown', groups)).toEqual(groups.flat())
  })
})
