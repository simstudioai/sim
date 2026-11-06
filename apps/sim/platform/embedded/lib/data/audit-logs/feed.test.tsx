/** @vitest-environment jsdom */

import { act } from 'react'
import {
  apiClientRequestMock,
  apiClientRequestMockFns,
} from '@sim/testing/mocks/api-client-request.mock'
import { nextNavigationMock } from '@sim/testing/mocks/next-navigation.mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => nextNavigationMock)
vi.mock('@/lib/api/client/request', () => apiClientRequestMock)

import { useAuditLogFeed } from '@/platform/embedded/lib/data/audit-logs/feed'
import { renderDataHook, unmountDataHooks } from '@/platform/embedded/lib/render-hook.test-support'

const NOW = Date.parse('2026-11-05T12:00:30.000Z')
const MINUTE_MS = 60_000

interface FeedQuery {
  startDate?: string
  cursor?: string
  resourceType?: string
}

function feedQueries(): FeedQuery[] {
  return apiClientRequestMockFns.mockRequestJson.mock.calls.map(([, args]) => args.query)
}

function pageFor(query: FeedQuery) {
  const id = `${query.startDate}/${query.cursor ?? 'first'}`
  return {
    success: true,
    data: [{ id }],
    nextCursor: query.cursor ? undefined : 'next',
  }
}

function renderFeed() {
  return renderDataHook(() => useAuditLogFeed('org-1'))
}

async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
}

describe('useAuditLogFeed window anchor', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW })
    apiClientRequestMockFns.mockRequestJson.mockImplementation(
      async (_contract: unknown, args: { query: FeedQuery }) => pageFor(args.query)
    )
  })
  afterEach(async () => {
    await unmountDataHooks()
    vi.useRealTimers()
  })

  it('keeps loaded pages and the export window when a render lands past a minute boundary', async () => {
    const { result, rerender } = await renderFeed()
    await flush()
    await act(async () => result.current.fetchNextPage())
    await flush()
    expect(result.current.entries).toHaveLength(2)
    const window = feedQueries()[0].startDate

    vi.setSystemTime(NOW + 5 * MINUTE_MS)
    await rerender()
    await flush()

    expect(result.current.entries).toHaveLength(2)
    expect(feedQueries()).toHaveLength(2)
    expect(feedQueries().every((query) => query.startDate === window)).toBe(true)
  })

  it('moves the window when a filter changes, once', async () => {
    const { result, rerender } = await renderFeed()
    await flush()
    const before = feedQueries()[0].startDate

    vi.setSystemTime(NOW + 5 * MINUTE_MS)
    await act(async () => result.current.setTypes(['workflow']))
    await flush()
    await rerender()
    await flush()

    const filtered = feedQueries().filter((query) => query.resourceType === 'workflow')
    expect(filtered).toHaveLength(1)
    expect(filtered[0].startDate).not.toBe(before)
    expect(Date.parse(filtered[0].startDate ?? '')).toBe(Date.parse(before ?? '') + 5 * MINUTE_MS)
  })

  it('moves the window on Refresh, holding the rows until the new window answers', async () => {
    const { result } = await renderFeed()
    await flush()
    const before = feedQueries()[0].startDate
    const shown = result.current.entries[0].id

    vi.setSystemTime(NOW + 5 * MINUTE_MS)
    let answer: (value: unknown) => void = () => {}
    apiClientRequestMockFns.mockRequestJson.mockImplementationOnce(
      (_contract: unknown, args: { query: FeedQuery }) =>
        new Promise((resolve) => {
          answer = () => resolve(pageFor(args.query))
        })
    )
    let refreshed: Promise<void> = Promise.resolve()
    await act(async () => {
      refreshed = result.current.refresh()
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.entries[0].id).toBe(shown)

    await act(async () => {
      answer(undefined)
      await refreshed
    })
    await flush()

    expect(result.current.entries).toHaveLength(1)
    expect(result.current.entries[0].id).not.toBe(shown)
    expect(feedQueries()).toHaveLength(2)
    expect(feedQueries()[1].startDate).not.toBe(before)
  })

  it('keeps the rows when the moved window fails, and refetches in place within the minute', async () => {
    const { result } = await renderFeed()
    await flush()
    const shown = result.current.entries[0].id

    await act(async () => result.current.refresh())
    await flush()
    expect(feedQueries()).toHaveLength(2)
    expect(feedQueries()[1].startDate).toBe(feedQueries()[0].startDate)

    vi.setSystemTime(NOW + 5 * MINUTE_MS)
    apiClientRequestMockFns.mockRequestJson.mockRejectedValueOnce(new Error('down'))
    await act(async () => result.current.refresh())
    await flush()

    expect(result.current.entries[0].id).toBe(shown)
  })

  it('does not apply a Refresh that a filter change overtook', async () => {
    const { result } = await renderFeed()
    await flush()

    vi.setSystemTime(NOW + 5 * MINUTE_MS)
    let answer: (value: unknown) => void = () => {}
    apiClientRequestMockFns.mockRequestJson.mockImplementationOnce(
      (_contract: unknown, args: { query: FeedQuery }) =>
        new Promise((resolve) => {
          answer = () => resolve(pageFor(args.query))
        })
    )
    let refreshed: Promise<void> = Promise.resolve()
    await act(async () => {
      refreshed = result.current.refresh()
      await vi.advanceTimersByTimeAsync(0)
    })
    vi.setSystemTime(NOW + 7 * MINUTE_MS)
    await act(async () => result.current.setTypes(['workflow']))
    await flush()
    const filtered = feedQueries().filter((query) => query.resourceType === 'workflow')

    await act(async () => {
      answer(undefined)
      await refreshed
    })
    await flush()

    expect(feedQueries().filter((query) => query.resourceType === 'workflow')).toEqual(filtered)
  })
})
