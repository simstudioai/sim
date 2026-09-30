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
})
