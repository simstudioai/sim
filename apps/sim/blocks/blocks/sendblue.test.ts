import { describe, expect, it } from 'vitest'
import { SendblueBlock } from '@/blocks/blocks/sendblue'

/** Runs the mapper the way a tool call does: merged row and model args under the mapper's result. */
function resolveToolCall(args: Record<string, unknown>, operation: string) {
  const mapper = SendblueBlock.tools.config?.params
  if (!mapper) throw new Error('Sendblue block has no params mapper')
  return { ...args, ...mapper(args, { operation }) }
}

describe('SendblueBlock agent tool calls', () => {
  it('splits recipients saved on the tool row when the operation arrives only in context', () => {
    const result = resolveToolCall(
      { numbers: '+19998887777\n+13334445555', from_number: '+15550001111', content: 'hi' },
      'sendblue_send_group_message'
    )

    expect(result.numbers).toEqual(['+19998887777', '+13334445555'])
  })

  it('keeps the typing state the model sends under the tool param name', () => {
    const result = resolveToolCall(
      { number: '+19998887777', state: 'stop' },
      'sendblue_send_typing_indicator'
    )

    expect(result.state).toBe('stop')
  })
})
