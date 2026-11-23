/**
 * Temporal block mapper on the agent tool-call path, where the operation arrives only in the
 * mapper context and the merged params mix stored block fields with model args keyed by tool params.
 */
import { describe, expect, it } from 'vitest'
import { TemporalBlock } from '@/blocks/blocks/temporal'

function params(
  input: Record<string, unknown>,
  context?: { operation: string }
): Record<string, unknown> {
  return TemporalBlock.tools.config?.params?.(input as never, context) as Record<string, unknown>
}

describe('temporal mapper on tool calls', () => {
  it('forwards a stored schedule query and keeps the model page size and token', () => {
    expect(
      params(
        { scheduleQuery: 'TemporalScheduledById = "x"', maximumPageSize: 25, nextPageToken: 'abc' },
        { operation: 'list_schedules' }
      )
    ).toMatchObject({
      query: 'TemporalScheduledById = "x"',
      maximumPageSize: 25,
      nextPageToken: 'abc',
    })
  })

  it('does not create a paused schedule when the model sends paused as the string "false"', () => {
    expect(
      params(
        { scheduleId: 's', cronExpressions: '0 12 * * *', paused: 'false' },
        { operation: 'create_schedule' }
      )
    ).toMatchObject({ cronExpressions: '0 12 * * *', paused: false })
  })
})
