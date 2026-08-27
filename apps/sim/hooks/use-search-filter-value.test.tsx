/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSearchFilterValue } from '@/hooks/use-search-filter-value'

const DELAY_MS = 200
const mountedRoots: Root[] = []

/** Drives the hook the way a search box does: re-render with each new input value. */
function renderSearchFilterValue(initial: string) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const root = createRoot(document.createElement('div'))
  mountedRoots.push(root)

  let result = ''

  function Probe({ value }: { value: string }) {
    result = useSearchFilterValue(value, DELAY_MS)
    return null
  }

  act(() => root.render(<Probe value={initial} />))

  return {
    get current() {
      return result
    },
    type(value: string) {
      act(() => root.render(<Probe value={value} />))
    },
    settle() {
      act(() => {
        vi.advanceTimersByTime(DELAY_MS)
      })
    },
    wait(ms: number) {
      act(() => {
        vi.advanceTimersByTime(ms)
      })
    },
  }
}

describe('useSearchFilterValue', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    act(() => {
      for (const root of mountedRoots.splice(0)) root.unmount()
    })
    vi.useRealTimers()
  })

  it('filters on a deep-linked term from the first render', () => {
    expect(renderSearchFilterValue('report').current).toBe('report')
  })

  it('starts empty and applies a typed term only once it settles', () => {
    const probe = renderSearchFilterValue('')
    expect(probe.current).toBe('')
    probe.type('rep')
    expect(probe.current).toBe('')
    probe.settle()
    expect(probe.current).toBe('rep')
  })

  it('drops the term the instant it is cleared, without waiting out the window', () => {
    const probe = renderSearchFilterValue('report')
    probe.type('')
    expect(probe.current).toBe('')
  })

  /**
   * The regression this hook exists to prevent, and the one masking alone did not: opening a
   * folder clears the term, and typing again inside the same debounce window must not resurrect
   * the term from before the clear — the list would search the whole workspace for something
   * the user had already abandoned.
   */
  it('never resurrects the pre-clear term when the user types again straight away', () => {
    const probe = renderSearchFilterValue('report')
    probe.type('')
    probe.wait(DELAY_MS / 4)
    probe.type('b')
    expect(probe.current).toBe('')
    probe.wait(DELAY_MS / 4)
    expect(probe.current).toBe('')
    probe.settle()
    expect(probe.current).toBe('b')
  })

  it('keeps showing the previous term while a longer one is still being typed', () => {
    const probe = renderSearchFilterValue('')
    probe.type('re')
    probe.settle()
    expect(probe.current).toBe('re')
    probe.type('rep')
    expect(probe.current).toBe('re')
    probe.settle()
    expect(probe.current).toBe('rep')
  })

  it('treats a whitespace-only term as cleared', () => {
    const probe = renderSearchFilterValue('report')
    probe.type('   ')
    expect(probe.current).toBe('')
    probe.settle()
    expect(probe.current).toBe('')
  })
})
