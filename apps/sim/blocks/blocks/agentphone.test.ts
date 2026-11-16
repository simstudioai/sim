import { describe, expect, it } from 'vitest'
import { AgentPhoneBlock } from '@/blocks/blocks/agentphone'

/** Runs the mapper the way an Agent tool call does: its result is spread over the merged args. */
function toolCall(args: Record<string, unknown>, operation: string) {
  const mapParams = AgentPhoneBlock.tools.config?.params
  if (!mapParams) throw new Error('AgentPhone block has no params mapper')
  return { ...args, ...mapParams(args, { operation }) }
}

describe('AgentPhoneBlock agent tool calls', () => {
  it('maps block-field filters and coerces limits for an operation passed only in context', () => {
    expect(
      toolCall({ apiKey: 'key', callsStatus: 'completed', limit: '25' }, 'list_calls')
    ).toMatchObject({ status: 'completed', limit: 25 })
  })
})
