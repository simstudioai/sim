import { describe, expect, it } from 'vitest'
import { CirclebackBlock } from '@/blocks/blocks/circleback'

/**
 * A tool call merges the stored row with the model's args (keyed by tool param names) and spreads
 * the mapper result over them; the operation arrives only in `context`.
 */
const toolCall = (args: Record<string, unknown>, operation: string) => ({
  ...args,
  ...CirclebackBlock.tools.config?.params?.(args, { operation }),
})

describe('CirclebackBlock tool calls', () => {
  it('sends the stored action-item filters under the tool param names', () => {
    const params = toolCall(
      { statusFilter: 'DONE', assigneeFilterProfileId: 'profile-1' },
      'list_action_items'
    )
    expect(params.status).toBe('DONE')
    expect(params.assigneeProfileId).toBe('profile-1')
  })
})
