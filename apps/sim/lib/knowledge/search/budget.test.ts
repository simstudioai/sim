import { db } from '@sim/db'
import { describe, expect, it, vi } from 'vitest'
import { SearchBudget, SearchDeadlineError } from '@/lib/knowledge/search/budget'

describe('search SQL deadline', () => {
  it('does not start a fallback with a fresh budget', async () => {
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const budget = new SearchBudget('vector', 100)
    const run = vi.fn(async () => {
      now = 101
      return ['candidate']
    })
    await budget.query('vector.candidate_search', run)
    await expect(budget.query('vector.exact', run)).rejects.toBeInstanceOf(SearchDeadlineError)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('returns at the acquisition deadline and skips work when the queued transaction later starts', async () => {
    vi.useFakeTimers()
    try {
      let begin: (() => void) | undefined
      let finished: Promise<unknown> | undefined
      vi.spyOn(db, 'transaction').mockImplementation((callback) => {
        finished = new Promise<void>((resolve) => {
          begin = resolve
        }).then(() => callback(db as never))
        return finished as ReturnType<typeof db.transaction>
      })
      const run = vi.fn(async () => ['private result'])
      const budget = new SearchBudget('keyword', performance.now() + 50)
      const pending = budget.query('keyword.sql', run)
      const assertion = expect(pending).rejects.toBeInstanceOf(SearchDeadlineError)
      await vi.advanceTimersByTimeAsync(60)
      await assertion
      begin!()
      await expect(finished).rejects.toBeInstanceOf(SearchDeadlineError)
      expect(run).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('caps a step without letting it shorten or outlive the leg it came from', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0)
    const controller = new AbortController()
    const leg = new SearchBudget('vector', 1000, controller.signal)
    const step = leg.capped(600)
    expect(step.deadline).toBe(600)
    expect(step.leg).toBe('vector')
    expect(step.signal).toBe(controller.signal)
    /** Spending the step is the step's own business; the leg keeps its deadline and its verdict. */
    step.isTimeout(new SearchDeadlineError())
    expect(step.timedOut).toBe(true)
    expect(leg.timedOut).toBe(false)
    expect(leg.remaining()).toBe(1000)
    /** A step longer than what the leg has left cannot extend it. */
    expect(new SearchBudget('vector', 200).capped(600).deadline).toBe(200)
  })

  it('preserves cancellation and unexpected errors instead of labeling them incomplete evidence', async () => {
    const controller = new AbortController()
    const budget = new SearchBudget('keyword', performance.now() - 1, controller.signal)
    const denied = new Error('access revoked')
    expect(budget.isTimeout(denied)).toBe(false)
    controller.abort(denied)
    expect(() => budget.isTimeout(new SearchDeadlineError())).toThrow(denied)
  })
})
