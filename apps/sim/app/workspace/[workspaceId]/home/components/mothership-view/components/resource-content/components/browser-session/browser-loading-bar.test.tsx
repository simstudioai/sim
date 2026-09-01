/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserLoadingBar } from './browser-loading-bar'

let container: HTMLDivElement
let root: Root

function render(loading: boolean): void {
  act(() => root.render(<BrowserLoadingBar loading={loading} />))
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
})

describe('BrowserLoadingBar', () => {
  it('reaches 100% before it disappears after loading settles', () => {
    render(true)
    expect(container.querySelector('[role="progressbar"]')?.getAttribute('data-phase')).toBe(
      'loading'
    )

    render(false)
    const completing = container.querySelector('[role="progressbar"]')
    expect(completing?.getAttribute('data-phase')).toBe('completing')
    expect(completing?.getAttribute('aria-valuenow')).toBe('100')

    act(() => vi.advanceTimersByTime(199))
    expect(container.querySelector('[role="progressbar"]')).not.toBeNull()

    act(() => vi.advanceTimersByTime(1))
    expect(container.querySelector('[role="progressbar"]')).toBeNull()
  })

  it('cancels completion when another navigation starts', () => {
    render(true)
    render(false)
    render(true)

    act(() => vi.advanceTimersByTime(500))
    expect(container.querySelector('[role="progressbar"]')?.getAttribute('data-phase')).toBe(
      'loading'
    )
  })
})
