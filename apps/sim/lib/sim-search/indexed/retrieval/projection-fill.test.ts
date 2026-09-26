/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SearchBudget } from '@/lib/knowledge/search/budget'
import {
  forgetProjectionFilled,
  isProjectionFilled,
} from '@/lib/sim-search/indexed/retrieval/projection-fill'

const LEG_BUDGET_MS = 8000

describe('projection fill probe', () => {
  beforeEach(() => forgetProjectionFilled())

  it('remembers a failed probe as unfilled rather than probing again on every search', async () => {
    const query = vi
      .spyOn(SearchBudget.prototype, 'query')
      .mockRejectedValue(new Error('connection reset'))
    const budget = new SearchBudget('keyword', performance.now() + LEG_BUDGET_MS)
    await expect(
      isProjectionFilled('embedding_keyword_tin', 'keyword.projection_filled', budget)
    ).resolves.toBe(false)
    await expect(
      isProjectionFilled('embedding_keyword_tin', 'keyword.projection_filled', budget)
    ).resolves.toBe(false)
    expect(query).toHaveBeenCalledOnce()
  })

  it('does not hold a later search past its own share while another search probes', async () => {
    vi.useFakeTimers()
    try {
      let answerFirst: (rows: Array<{ unfilled: boolean }>) => void = () => {}
      vi.spyOn(SearchBudget.prototype, 'query').mockImplementation(
        () =>
          new Promise((resolve) => {
            answerFirst = resolve as typeof answerFirst
          }) as ReturnType<SearchBudget['query']>
      )
      const first = isProjectionFilled(
        'embedding_search',
        'vector.projection_filled',
        new SearchBudget('vector', performance.now() + LEG_BUDGET_MS)
      )
      let secondSettled = false
      const second = isProjectionFilled(
        'embedding_search',
        'vector.projection_filled',
        new SearchBudget('vector', performance.now() + 20)
      ).finally(() => {
        secondSettled = true
      })
      await vi.advanceTimersByTimeAsync(20)
      expect(secondSettled).toBe(true)
      await expect(second).resolves.toBe(false)
      answerFirst([{ unfilled: false }])
      await expect(first).resolves.toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not remember a probe its own search cancelled', async () => {
    const query = vi
      .spyOn(SearchBudget.prototype, 'query')
      .mockRejectedValue(new DOMException('aborted', 'AbortError'))
    const controller = new AbortController()
    controller.abort()
    const budget = new SearchBudget('vector', performance.now() + LEG_BUDGET_MS, controller.signal)
    await expect(
      isProjectionFilled('embedding_search', 'vector.projection_filled', budget)
    ).resolves.toBe(false)
    await expect(
      isProjectionFilled('embedding_search', 'vector.projection_filled', budget)
    ).resolves.toBe(false)
    expect(query).toHaveBeenCalledTimes(2)
  })
})
