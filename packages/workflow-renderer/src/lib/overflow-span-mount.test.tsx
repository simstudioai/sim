/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OverflowSpan } from './overflow-span'

let root: Root | null = null
let host: HTMLDivElement | null = null

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal(
    'ResizeObserver',
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  if (root) act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('OverflowSpan code preview', () => {
  it('renders the complete source after the code-card dwell', () => {
    const code = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join('\n')
    act(() => {
      root?.render(
        <OverflowSpan
          value='line 1'
          className='truncate'
          codePreview={{ code, language: 'javascript' }}
        />
      )
    })

    const trigger = host?.querySelector<HTMLElement>('span')
    if (!trigger) throw new Error('Overflow trigger did not render')
    Object.defineProperties(trigger, {
      clientWidth: { configurable: true, value: 50 },
      scrollWidth: { configurable: true, value: 200 },
    })

    act(() => {
      trigger.dispatchEvent(
        new MouseEvent('pointerover', { bubbles: true, clientX: 200, clientY: 200 })
      )
      vi.advanceTimersByTime(299)
    })
    expect(document.querySelector('[data-native-surface-overlay]')).toBeNull()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    const preview = document.querySelector('[data-code-hover-card]')
    expect(preview).toHaveTextContent('line 20')
    expect(preview).toHaveClass('w-fit', 'max-w-[min(16rem,calc(100vw-2rem))]', 'shadow-sm')
    expect(preview?.querySelector('.overflow-x-auto')).toHaveClass('overflow-y-auto')
    expect(preview?.querySelector('.tabular-nums')).toBeNull()
    expect(preview?.querySelector('pre')).toHaveClass('px-2', 'py-1.5', 'text-caption', 'leading-5')
  })

  it('stays open while the pointer crosses into the scrollable preview', () => {
    act(() => {
      root?.render(
        <OverflowSpan
          value='const value = 1'
          className='truncate'
          codePreview={{ code: 'const value = 1', language: 'javascript' }}
        />
      )
    })

    const trigger = host?.querySelector<HTMLElement>('span')
    if (!trigger) throw new Error('Overflow trigger did not render')
    Object.defineProperties(trigger, {
      clientWidth: { configurable: true, value: 50 },
      scrollWidth: { configurable: true, value: 200 },
    })

    act(() => {
      trigger.dispatchEvent(
        new MouseEvent('pointerover', { bubbles: true, clientX: 200, clientY: 200 })
      )
      vi.advanceTimersByTime(300)
    })
    const preview = document.querySelector<HTMLElement>('[data-code-hover-card]')
    if (!preview) throw new Error('Code preview did not render')

    act(() => {
      trigger.dispatchEvent(new MouseEvent('pointerout', { bubbles: true }))
      vi.advanceTimersByTime(500)
      preview.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
      vi.advanceTimersByTime(600)
    })
    expect(document.querySelector('[data-code-hover-card]')).not.toBeNull()

    act(() => {
      preview.dispatchEvent(new MouseEvent('pointerout', { bubbles: true }))
      vi.advanceTimersByTime(119)
    })
    expect(document.querySelector('[data-code-hover-card]')).not.toBeNull()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(document.querySelector('[data-code-hover-card]')).toBeNull()
  })
})
