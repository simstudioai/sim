import { describe, expect, it, vi } from 'vitest'
import { withPostActionObservation } from '@/main/browser-agent/post-action-observation'

describe('post-action observation', () => {
  it('observes after the action, preserving partial form results and replacing refs', async () => {
    const order: string[] = []
    const result = await withPostActionObservation(
      'browser_fill_form',
      { observe: { query: 'Save' } },
      async () => {
        order.push('action')
        return { completed: false, completedCount: 1, doNotRetry: true }
      },
      async (query) => {
        order.push('observe')
        expect(query).toBe('Save')
        return { matches: [{ elementId: 24, line: 'button Save [ref=24]' }] }
      },
      vi.fn()
    )
    expect(order).toEqual(['action', 'observe'])
    expect(result).toMatchObject({
      completed: false,
      completedCount: 1,
      doNotRetry: true,
      observation: { ok: true, result: { matches: [{ elementId: 24 }] } },
    })
  })

  it('does not repeat or misreport a dispatched action when observation fails', async () => {
    const action = vi.fn(async () => ({ dispatched: true, effectObserved: false }))
    const result = await withPostActionObservation(
      'browser_click',
      { observe: {} },
      action,
      async () => {
        throw new Error('Page changed')
      },
      vi.fn()
    )
    expect(action).toHaveBeenCalledTimes(1)
    expect(action).toHaveBeenCalledWith({})
    expect(result).toMatchObject({
      dispatched: true,
      effectObserved: false,
      observation: { ok: false, error: 'Page changed' },
    })
  })

  it('preserves completed actions when execution expires before observation', async () => {
    const observe = vi.fn()
    await expect(
      withPostActionObservation(
        'browser_type',
        { observe: {} },
        async () => ({ typed: true }),
        observe,
        () => {
          throw new Error('Cancelled')
        }
      )
    ).resolves.toMatchObject({
      typed: true,
      observation: { ok: false, error: 'Cancelled', doNotRetry: true },
    })
    expect(observe).not.toHaveBeenCalled()
  })

  it.each([false, true])(
    'preserves completed actions when execution expires during observation (observation fails: %s)',
    async (fails) => {
      let expired = false
      await expect(
        withPostActionObservation(
          'browser_click',
          { observe: {} },
          async () => ({ dispatched: true }),
          async () => {
            expired = true
            if (fails) throw new Error('Page changed')
            return { outline: 'Stale snapshot' }
          },
          () => {
            if (expired) throw new Error('Cancelled')
          }
        )
      ).resolves.toMatchObject({
        dispatched: true,
        observation: {
          ok: false,
          error: fails ? 'Page changed' : 'Cancelled',
          doNotRetry: true,
        },
      })
    }
  )
})
