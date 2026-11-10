/**
 * @vitest-environment jsdom
 *
 * How the Logs list reads again once new runs start. Failure modes: a reader scrolled deep in the
 * list losing their place because the list collapsed to its first page; a merge that duplicates a
 * run, skips one, or leaves the next page reading from the wrong place; and a merge trusted after
 * the held snapshot changed underneath it.
 */
import { act } from 'react'
import {
  apiClientRequestMock,
  apiClientRequestMockFns,
} from '@sim/testing/mocks/api-client-request.mock'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('@/lib/api/client/request', () => apiClientRequestMock)

import { NEW_LOG_COUNT_STALE_TIME } from '@/hooks/queries/logs'
import { useLiveRuns } from '@/platform/lib/data/logs'

const mockRequestJson = apiClientRequestMockFns.mockRequestJson

const VIEW = {
  view: 'runs',
  period: 'all',
  start: null,
  end: null,
  status: 'all',
  trigger: [],
  workflow: [],
  folder: [],
  sort: 'newest',
} as const

interface ServerRun {
  id: string
  /** When it started, as an instant on the server's clock. */
  at: number
}

/**
 * The logs route over an in-memory run table, newest first: a snapshot holds the runs started at or
 * before its instant, its revision names exactly those runs, and a cursor is an offset into it.
 */
let server: ServerRun[]
let clock: number

function visibleAt(instant: number) {
  return server.filter((run) => run.at <= instant).sort((left, right) => right.at - left.at)
}

function summary(run: ServerRun) {
  return {
    id: run.id,
    executionId: run.id,
    workflowId: 'workflow-1',
    workflow: { id: 'workflow-1', name: 'Workflow' },
    status: 'completed',
    trigger: 'manual',
    createdAt: new Date(run.at * 1000).toISOString(),
    duration: '100ms',
    cost: null,
  }
}

function startRuns(count: number) {
  for (let index = 0; index < count; index++) {
    clock += 1
    server.push({ id: `run-${clock}`, at: clock })
  }
}

let container: HTMLDivElement
let root: Root
let live: ReturnType<typeof useLiveRuns>

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  server = []
  clock = 0
  startRuns(120)
  mockRequestJson.mockImplementation(async (_contract, { query }) => {
    if (query.startedAfter) {
      const after = Number(query.startedAfter)
      return { data: [], nextCursor: null, total: server.filter((run) => run.at > after).length }
    }
    const instant = query.snapshotAt === 'now' ? clock : Number(query.snapshotAt)
    const rows = visibleAt(instant)
    const revision = rows.map((run) => run.id).join(',')
    if (query.countOnly) return { data: [], nextCursor: null, total: rows.length, revision }
    const offset = query.cursor ? Number(query.cursor) : 0
    const end = offset + query.limit
    return {
      data: rows.slice(offset, end).map(summary),
      nextCursor: end < rows.length ? String(end) : null,
      snapshotAt: String(instant),
      revision,
    }
  })
  container = document.createElement('div')
  root = createRoot(container)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Probe() {
    live = useLiveRuns('ws-1', VIEW)
    return null
  }
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>
    )
  )
})

afterEach(() => {
  act(() => root.unmount())
  vi.useRealTimers()
})

async function settle(ms = 10) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

/** Reads two pages, as a reader scrolling past the first does. */
async function readTwoPages() {
  await settle()
  await act(async () => live.more.onLoadMore())
  await settle()
  expect(live.runs).toHaveLength(100)
}

function pageReads() {
  return mockRequestJson.mock.calls.filter(
    ([, request]) => !request.query.countOnly && !request.query.startedAfter
  )
}

it('drops to the first page when the reader is looking at it', async () => {
  await readTwoPages()
  act(() => live.onRowsInView(12))
  startRuns(3)
  await settle(NEW_LOG_COUNT_STALE_TIME)
  await settle()

  expect(live.runs).toHaveLength(50)
  expect(live.runs.slice(0, 4).map((run) => run.id)).toEqual([
    'run-123',
    'run-122',
    'run-121',
    'run-120',
  ])
  expect(live.more.hasMore).toBe(true)
})

it('keeps a deep reader’s pages, joining new runs at the head with one page read', async () => {
  await readTwoPages()
  act(() => live.onRowsInView(80))
  startRuns(3)
  mockRequestJson.mockClear()
  await settle(NEW_LOG_COUNT_STALE_TIME)
  await settle()

  expect(pageReads()).toHaveLength(1)
  expect(pageReads()[0]?.[1].query.cursor).toBeUndefined()
  const ids = live.runs.map((run) => run.id)
  expect(ids).toHaveLength(103)
  expect(new Set(ids).size).toBe(103)
  expect(ids.slice(0, 4)).toEqual(['run-123', 'run-122', 'run-121', 'run-120'])
  expect(ids.at(-1)).toBe('run-21')

  await act(async () => live.more.onLoadMore())
  await settle()
  const after = live.runs.map((run) => run.id)
  expect(after).toHaveLength(123)
  expect(new Set(after).size).toBe(123)
  expect(after.at(-1)).toBe('run-1')
  expect(live.more.hasMore).toBe(false)
})

it('reads every page again for a deep reader when the held snapshot changed underneath', async () => {
  await readTwoPages()
  act(() => live.onRowsInView(80))
  server = server.filter((run) => run.id !== 'run-60')
  startRuns(3)
  await settle(NEW_LOG_COUNT_STALE_TIME)
  await settle()

  const ids = live.runs.map((run) => run.id)
  expect(ids).toHaveLength(100)
  expect(ids).not.toContain('run-60')
  expect(new Set(ids).size).toBe(100)
  expect(ids.slice(0, 3)).toEqual(['run-123', 'run-122', 'run-121'])
})

it('reads every page again for a deep reader when more runs started than a page holds', async () => {
  await readTwoPages()
  act(() => live.onRowsInView(80))
  startRuns(60)
  await settle(NEW_LOG_COUNT_STALE_TIME)
  await settle()

  const ids = live.runs.map((run) => run.id)
  expect(ids).toEqual(Array.from({ length: 100 }, (_, index) => `run-${180 - index}`))
})
