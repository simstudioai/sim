/**
 * @vitest-environment jsdom
 *
 * The table's load-more footer keeps two concerns apart: its spinner shows only while the next
 * page loads, and its sentinel waits out any request for the list — a background refetch
 * included — then asks again once it settles, so reaching the bottom mid-refetch never stalls.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Resource } from '@/app/workspace/[workspaceId]/components/resource/resource'

/** Each observed sentinel, reported as on screen the moment it is observed. */
class OnScreenObserver {
  constructor(private readonly report: IntersectionObserverCallback) {}
  observe(target: Element) {
    this.report(
      [{ isIntersecting: true, target } as unknown as IntersectionObserverEntry],
      this as unknown as IntersectionObserver
    )
  }
  disconnect() {}
  unobserve() {}
  takeRecords() {
    return []
  }
}

const columns = [{ id: 'name', header: 'Name' }]
const rows = [{ id: 'a', cells: { name: { label: 'a.md' } } }]

describe('Resource.Table paging footer', () => {
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', OnScreenObserver)
    container = document.createElement('div')
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
  })

  function render(props: { isLoadingMore: boolean; isFetching: boolean; onLoadMore: () => void }) {
    act(() => {
      root.render(<Resource.Table columns={columns} rows={rows} hasMore {...props} />)
    })
  }

  it('asks for the next page once a background refetch it reached the bottom during settles', () => {
    const onLoadMore = vi.fn()
    render({ isLoadingMore: false, isFetching: true, onLoadMore })
    expect(onLoadMore).not.toHaveBeenCalled()

    render({ isLoadingMore: false, isFetching: false, onLoadMore })
    expect(onLoadMore).toHaveBeenCalledTimes(1)
  })

  it('shows the bottom spinner for a next page, never for a background refetch', () => {
    const onLoadMore = vi.fn()
    /** The footer is the sentinel the table mounts below its rows while more pages remain. */
    const footer = () => container.querySelector('.py-3')
    render({ isLoadingMore: false, isFetching: true, onLoadMore })
    expect(footer()).not.toBeNull()
    expect(footer()?.childElementCount).toBe(0)

    render({ isLoadingMore: true, isFetching: true, onLoadMore })
    expect(footer()?.childElementCount).toBe(1)
  })
})
