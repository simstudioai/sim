/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { parseConversationHistoryGroup } from '@/lib/memory/history-group'

const legacyCall = {
  role: 'assistant',
  content: null,
  function_call: { name: 'lookup', arguments: '{}' },
}
const legacyResult = { role: 'function', name: 'lookup', content: 'result' }
const toolCall = (id: string) => ({
  id,
  type: 'function',
  function: { name: 'lookup', arguments: '{}' },
})
const parallelCall = {
  role: 'assistant',
  content: null,
  tool_calls: [toolCall('first'), toolCall('second')],
}
const result = (id: string) => ({ role: 'tool', tool_call_id: id, content: 'result' })
const text = { role: 'user', content: 'conversation text or bounded execution record' }

describe('stored conversation history groups', () => {
  it.each([
    [text],
    [legacyCall, legacyResult],
    [{ ...legacyCall, content: 'Calling lookup' }, legacyResult],
    [legacyCall, legacyResult, legacyCall, legacyResult],
    [parallelCall, result('second'), result('first')],
    [parallelCall, result('first'), { ...result('second'), content: '{"error":"tool failed"}' }],
  ])('retains complete history unchanged: %j', (...group) => {
    expect(parseConversationHistoryGroup(group)).toBe(group)
  })

  it.each([
    [],
    [{ role: { toString: 1 }, content: 'invalid role' }],
    [legacyCall],
    [{ ...legacyCall, content: 'Calling lookup' }],
    [legacyResult],
    [legacyCall, { ...legacyResult, name: 'different' }],
    [legacyCall, legacyResult, legacyResult],
    [legacyCall, text, legacyResult],
    [legacyCall, result('lookup')],
    [parallelCall],
    [parallelCall, result('first')],
    [parallelCall, result('first'), result('first')],
    [parallelCall, result('first'), result('different')],
    [parallelCall, result('first'), text, result('second')],
    [result('first'), parallelCall, result('first'), result('second')],
    [{ ...parallelCall, tool_calls: [toolCall('first'), toolCall('first')] }, result('first')],
    [{ ...parallelCall, tool_calls: [{ ...toolCall('first'), id: '' }] }, result('')],
    [{ ...parallelCall, function_call: legacyCall.function_call }, legacyResult],
    [{ ...legacyCall, role: 'user' }, legacyResult],
    [{ ...parallelCall, role: 'user' }, result('first'), result('second')],
    [{ role: 'assistant', content: null }],
    [{ role: 'assistant', content: null, tool_calls: [] }],
    [{ role: 'assistant', content: 'text', tool_calls: 'invalid' }],
    [{ ...legacyCall, function_call: { name: 'lookup', arguments: {} } }, legacyResult],
  ])('omits incomplete or malformed groups: %j', (...group) => {
    expect(parseConversationHistoryGroup(group)).toBeUndefined()
  })
})
