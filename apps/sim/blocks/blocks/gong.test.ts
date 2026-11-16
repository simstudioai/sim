/**
 * Agent tool calls pass the operation in context and supply arguments under the tool's param
 * names, which the mapper spreads over and must keep.
 */
import { describe, expect, it } from 'vitest'
import { GongBlock } from '@/blocks/blocks/gong'

function agentParams(operation: string, args: Record<string, unknown>): Record<string, unknown> {
  return { ...args, ...(GongBlock.tools.config?.params?.(args, { operation }) ?? {}) }
}

describe('GongBlock agent tool calls', () => {
  it('keeps the model flowId when unassigning flow prospects', () => {
    const params = agentParams('unassign_flow_prospects', {
      crmProspectId: 'lead-1',
      flowId: 'flow-9',
    })
    expect(params.flowId).toBe('flow-9')
  })
})
