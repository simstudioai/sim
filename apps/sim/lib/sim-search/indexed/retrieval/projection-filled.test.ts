/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SearchBudget } from '@/lib/knowledge/search/budget'
import {
  forgetProjectionFilled,
  isProjectionFilled,
  PROJECTION_FILLED_PROBE_BUDGET_MS,
} from '@/lib/sim-search/indexed/retrieval/projection-filled'

const LEG_BUDGET_MS = 8000

describe('projection fill probe', () => {
  beforeEach(() => forgetProjectionFilled())
  afterEach(() => vi.restoreAllMocks())

  it('spends at most its capped share of the leg budget', async () => {
    vi.spyOn(performance, 'now').mockReturnValue(1000)
    const deadlines: number[] = []
    vi.spyOn(SearchBudget.prototype, 'query').mockImplementation(async function (
      this: SearchBudget
    ) {
      deadlines.push(this.deadline)
      return [{ unfilled: false }]
    } as SearchBudget['query'])
    const budget = new SearchBudget('vector', 1000 + LEG_BUDGET_MS)
    await expect(
      isProjectionFilled('embedding_search', 'vector.projection_filled', budget)
    ).resolves.toBe(true)
    expect(deadlines).toEqual([1000 + PROJECTION_FILLED_PROBE_BUDGET_MS])
    expect(budget.timedOut).toBe(false)
  })

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
    const started = performance.now()
    await expect(
      isProjectionFilled(
        'embedding_search',
        'vector.projection_filled',
        new SearchBudget('vector', performance.now() + 20)
      )
    ).resolves.toBe(false)
    expect(performance.now() - started).toBeLessThan(PROJECTION_FILLED_PROBE_BUDGET_MS)
    answerFirst([{ unfilled: false }])
    await expect(first).resolves.toBe(true)
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
