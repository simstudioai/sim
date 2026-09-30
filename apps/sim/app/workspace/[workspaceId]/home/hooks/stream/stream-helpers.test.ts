import { describe, expect, it } from 'vitest'
import { finalizeResidualToolCalls } from '@/app/workspace/[workspaceId]/home/hooks/stream/stream-helpers'
import type { ContentBlock } from '@/app/workspace/[workspaceId]/home/types'

describe('finalizeResidualToolCalls', () => {
  it.each(['executing', 'awaiting_approval'] as const)(
    'settles a %s tool row with the turn outcome on Stop',
    (status) => {
      const blocks: ContentBlock[] = [
        { type: 'tool_call', toolCall: { id: 'call-1', name: 'gmail_read_v2', status } },
      ]

      finalizeResidualToolCalls(blocks, 'cancelled')

      expect(blocks[0].toolCall?.status).toBe('cancelled')
    }
  )

  it('reports whether any tool row was left to settle', () => {
    const open: ContentBlock[] = [
      { type: 'tool_call', toolCall: { id: 'call-1', name: 'read', status: 'awaiting_approval' } },
    ]
    const settled: ContentBlock[] = [
      { type: 'tool_call', toolCall: { id: 'call-2', name: 'read', status: 'success' } },
    ]

    expect(finalizeResidualToolCalls(open, 'error')).toBe(true)
    expect(finalizeResidualToolCalls(settled, 'error')).toBe(false)
  })

  it('reports closing an open subagent lane as a change to persist', () => {
    const blocks: ContentBlock[] = [{ type: 'subagent', content: 'research' }]

    expect(finalizeResidualToolCalls(blocks, 'error')).toBe(true)
    expect(blocks[0].endedAt).toEqual(expect.any(Number))
  })
})
