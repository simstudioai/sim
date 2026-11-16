/**
 * Agent tool calls pass the operation in context and supply arguments under the tool's param
 * names, which the mapper spreads over and must keep.
 */
import { describe, expect, it } from 'vitest'
import { GrainV2Block } from '@/blocks/blocks/grain'

function agentParams(operation: string, args: Record<string, unknown>): Record<string, unknown> {
  return { ...args, ...(GrainV2Block.tools.config?.params?.(args, { operation }) ?? {}) }
}

describe('GrainV2Block agent tool calls', () => {
  it('keeps the model include options when creating a webhook', () => {
    const params = agentParams('grain_create_hook_v2', {
      hookUrl: 'https://example.com/hook',
      hookType: 'recording_added',
      include: { participants: true },
    })
    expect(params.include).toEqual({ participants: true })
  })

  it('keeps the model event type and state filters when listing webhooks', () => {
    const params = agentParams('grain_list_hooks_v2', {
      hookType: 'highlight_added',
      state: 'enabled',
    })
    expect(params).toMatchObject({ hookType: 'highlight_added', state: 'enabled' })
  })
})
