import { describe, expect, it } from 'vitest'
import {
  AgentContextLimitError,
  type ConversationContextGroup,
  getConversationHistoryTokenBudget,
  selectConversationContextGroups,
} from '@/lib/memory/context-policy'

const budget = { contextWindow: 32_000, fixedTokens: 1000, outputTokens: 2000 }

describe('Agent context selection', () => {
  it('keeps required input and the newest intact history within a deliberate history budget', () => {
    expect(
      selectConversationContextGroups(
        [
          { value: 'old', tokens: 10_000 },
          { value: 'recent', tokens: 10_000 },
          { value: 'input', tokens: 1000, required: true },
          { value: 'parallel batch', tokens: 2000, required: true },
        ],
        budget
      )
    ).toEqual(['recent', 'input', 'parallel batch'])
  })

  it('uses the smaller model remaining capacity after all fixed inputs and output reserve', () => {
    expect(
      selectConversationContextGroups(
        [
          { value: 'old', tokens: 1000 },
          { value: 'recent', tokens: 1000 },
          { value: 'input', tokens: 1000, required: true },
        ],
        { contextWindow: 5000, fixedTokens: 1000, outputTokens: 1000 }
      )
    ).toEqual(['recent', 'input'])
  })

  it('does not split a parallel group or skip a missing segment to revive older history', () => {
    expect(
      selectConversationContextGroups(
        [
          { value: 'old', tokens: 1 },
          { value: 'large complete batch', tokens: 2000 },
          { value: 'recent', tokens: 1000 },
          { value: 'input', tokens: 100, required: true },
        ],
        { ...budget, historyTokens: 1500 }
      )
    ).toEqual(['recent', 'input'])
  })

  it('retains required native state even above the optional history target', () => {
    expect(
      selectConversationContextGroups(
        [{ value: 'native prefix', tokens: 20_000, required: true }],
        { ...budget, historyTokens: 1000 }
      )
    ).toEqual(['native prefix'])
  })

  it('drops optional history instead of refusing required context above the estimated capacity', () => {
    const required = Object.freeze([{ id: 'call' }, { id: 'result' }])
    const groups: ConversationContextGroup<string | typeof required>[] = [
      { value: 'old history', tokens: 1000 },
      { value: 'summary', tokens: 100, summary: true },
      { value: required, tokens: 30_000, required: true },
    ]
    expect(getConversationHistoryTokenBudget(groups, budget)).toBe(0)
    expect(selectConversationContextGroups(groups, budget)).toEqual([required])
    expect(selectConversationContextGroups(groups, budget)[0]).toBe(required)
  })

  it('reserves zero optional tokens when fixed input and output estimates exceed model capacity', () => {
    expect(getConversationHistoryTokenBudget([], { ...budget, fixedTokens: 40_000 })).toBe(0)
    expect(getConversationHistoryTokenBudget([], { ...budget, outputTokens: 40_000 })).toBe(0)
  })

  it('refuses non-finite accumulated estimates rather than using an invalid budget', () => {
    expect(() =>
      getConversationHistoryTokenBudget(
        [
          { value: 'first', tokens: Number.MAX_VALUE, required: true },
          { value: 'second', tokens: Number.MAX_VALUE, required: true },
        ],
        budget
      )
    ).toThrow(AgentContextLimitError)
  })

  it('keeps a bounded summary before spending the remaining history budget on recent raw groups', () => {
    expect(
      selectConversationContextGroups(
        [
          { value: 'summary', tokens: 400, summary: true },
          { value: 'old raw history', tokens: 400 },
          { value: 'recent raw history', tokens: 600 },
          { value: 'current input', tokens: 100, required: true },
        ],
        { ...budget, historyTokens: 1000 }
      )
    ).toEqual(['summary', 'recent raw history', 'current input'])
  })

  it('never displaces required state with a summary exceeding the remaining hard capacity', () => {
    const groups = [
      { value: 'summary', tokens: 500, summary: true },
      { value: 'recent', tokens: 100 },
      { value: 'required', tokens: 27_600, required: true },
    ]
    const options = { ...budget, fixedTokens: 100, outputTokens: 1000 }
    expect(getConversationHistoryTokenBudget(groups, options)).toBe(100)
    expect(selectConversationContextGroups(groups, options)).toEqual(['recent', 'required'])
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])('rejects invalid budget %s', (value) => {
    expect(() => selectConversationContextGroups([], { ...budget, historyTokens: value })).toThrow(
      AgentContextLimitError
    )
  })
})
