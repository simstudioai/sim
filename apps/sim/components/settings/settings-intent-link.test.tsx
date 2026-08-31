/**
 * @vitest-environment jsdom
 */
import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPathname } = vi.hoisted(() => ({ mockPathname: vi.fn(() => '/settings/billing') }))

vi.mock('next/navigation', () => ({ usePathname: mockPathname }))
vi.mock('next/link', () => ({
  default: ({
    prefetch,
    onNavigate: _onNavigate,
    ...props
  }: ComponentProps<'a'> & {
    prefetch: boolean
    onNavigate?: unknown
  }) => <a data-prefetch={String(prefetch)} {...props} />,
}))

import { SettingsIntentLink } from '@/components/settings/settings-intent-link'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers()
  mockPathname.mockReturnValue('/settings/billing')
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
})

function renderLink(
  props: Partial<ComponentProps<typeof SettingsIntentLink>> = {},
  onIntent = vi.fn()
) {
  act(() => {
    root.render(
      <SettingsIntentLink href='/settings/general' onIntent={onIntent} {...props}>
        General
      </SettingsIntentLink>
    )
  })
  const link = container.querySelector('a')
  if (!link) throw new Error('settings link not rendered')
  return { link, onIntent }
}

function pointerEvent(type: string, pointerType: 'mouse' | 'touch', init?: MouseEventInit) {
  const event = new MouseEvent(type, { bubbles: true, ...init })
  Object.defineProperty(event, 'pointerType', { value: pointerType })
  return event
}

describe('SettingsIntentLink', () => {
  it('enables full route prefetch after deliberate hover dwell', () => {
    const { link, onIntent } = renderLink()
    act(() => {
      link.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      vi.advanceTimersByTime(79)
    })
    expect(link).toHaveAttribute('data-prefetch', 'false')
    expect(onIntent).not.toHaveBeenCalled()

    act(() => vi.advanceTimersByTime(1))
    expect(link).toHaveAttribute('data-prefetch', 'true')
    expect(onIntent).toHaveBeenCalledTimes(1)
  })

  it('cancels drive-by hover intent and cleans up pending timers', () => {
    const { link, onIntent } = renderLink()
    act(() => {
      link.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      link.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))
      vi.runAllTimers()
    })
    expect(link).toHaveAttribute('data-prefetch', 'false')

    act(() => {
      link.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      root.unmount()
      vi.runAllTimers()
    })
    expect(onIntent).not.toHaveBeenCalled()
    root = createRoot(container)
  })

  it('prefetches immediately for keyboard focus and respects cancellation', () => {
    const canceled = renderLink({ onFocus: (event) => event.preventDefault() })
    act(() =>
      canceled.link.dispatchEvent(new FocusEvent('focusin', { bubbles: true, cancelable: true }))
    )
    expect(canceled.link).toHaveAttribute('data-prefetch', 'false')
    expect(canceled.onIntent).not.toHaveBeenCalled()

    const focused = renderLink()
    act(() => focused.link.dispatchEvent(new FocusEvent('focusin', { bubbles: true })))
    expect(focused.link).toHaveAttribute('data-prefetch', 'true')
    expect(focused.onIntent).toHaveBeenCalledTimes(1)
  })

  it('does not treat touchstart scrolling as navigation intent', () => {
    const onTouchStart = vi.fn()
    const { link, onIntent } = renderLink({ onTouchStart })
    act(() => link.dispatchEvent(new TouchEvent('touchstart', { bubbles: true })))
    expect(onTouchStart).toHaveBeenCalledTimes(1)
    expect(link).toHaveAttribute('data-prefetch', 'false')
    expect(onIntent).not.toHaveBeenCalled()
  })

  it('covers quick mouse clicks, completed touch taps, and click fallback', () => {
    const mouse = renderLink()
    act(() => mouse.link.dispatchEvent(pointerEvent('pointerdown', 'mouse', { button: 0 })))
    expect(mouse.link).toHaveAttribute('data-prefetch', 'true')
    expect(mouse.onIntent).toHaveBeenCalledTimes(1)
    act(() => mouse.link.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))

    const touch = renderLink()
    act(() => touch.link.dispatchEvent(pointerEvent('pointerup', 'touch', { button: 0 })))
    expect(touch.link).toHaveAttribute('data-prefetch', 'true')
    expect(touch.onIntent).toHaveBeenCalledTimes(1)
    act(() => touch.link.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))

    const fallback = renderLink({ href: '#general' })
    act(() =>
      fallback.link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    )
    expect(fallback.link).toHaveAttribute('data-prefetch', 'true')
    expect(fallback.onIntent).toHaveBeenCalledTimes(1)
  })

  it('ignores canceled and modified clicks', () => {
    const canceled = renderLink({ onClick: (event) => event.preventDefault() })
    act(() =>
      canceled.link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    )
    expect(canceled.link).toHaveAttribute('data-prefetch', 'false')
    expect(canceled.onIntent).not.toHaveBeenCalled()

    const modified = renderLink()
    act(() =>
      modified.link.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true })
      )
    )
    expect(modified.link).toHaveAttribute('data-prefetch', 'false')
    expect(modified.onIntent).not.toHaveBeenCalled()
  })

  it('never prefetches or warms data for the current route', () => {
    mockPathname.mockReturnValue('/settings/general')
    const { link, onIntent } = renderLink()
    act(() => {
      link.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      link.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
      link.dispatchEvent(pointerEvent('pointerdown', 'mouse', { button: 0 }))
      vi.runAllTimers()
    })
    expect(link).toHaveAttribute('data-prefetch', 'false')
    expect(onIntent).not.toHaveBeenCalled()
  })

  it('treats a descendant page as the current settings section', () => {
    mockPathname.mockReturnValue('/settings/billing/credit-usage')
    const { link, onIntent } = renderLink({ href: '/settings/billing' })

    act(() => {
      link.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      vi.runAllTimers()
    })

    expect(link).toHaveAttribute('data-prefetch', 'false')
    expect(onIntent).not.toHaveBeenCalled()
  })
})
