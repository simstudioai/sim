/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { handlePlanEvent } from '@/lib/mothership/request/handlers/plan'
import type { StreamEvent, StreamingContext } from '@/lib/mothership/request/types'

function contextWith(blocks: StreamingContext['contentBlocks']): StreamingContext {
  return { contentBlocks: blocks } as StreamingContext
}

const planEvent = (items: unknown): StreamEvent =>
  ({ type: 'plan', payload: { items } }) as unknown as StreamEvent

describe('handlePlanEvent', () => {
  it('creates one plan block and updates it in place on later events', () => {
    const context = contextWith([])
    handlePlanEvent(planEvent([{ step: 'a', status: 'active' }]), context, {} as never, {} as never)
    expect(context.contentBlocks).toHaveLength(1)
    expect(context.contentBlocks[0].planItems).toEqual([{ step: 'a', status: 'active' }])

    handlePlanEvent(
      planEvent([
        { step: 'a', status: 'done' },
        { step: 'b', status: 'active' },
      ]),
      context,
      {} as never,
      {} as never
    )
    expect(context.contentBlocks).toHaveLength(1)
    expect(context.contentBlocks[0].planItems).toHaveLength(2)
    expect(context.contentBlocks[0].planItems?.[0].status).toBe('done')
  })

  it('ignores malformed payloads', () => {
    const context = contextWith([])
    handlePlanEvent(planEvent(undefined), context, {} as never, {} as never)
    handlePlanEvent(planEvent([]), context, {} as never, {} as never)
    expect(context.contentBlocks).toHaveLength(0)
  })
})
