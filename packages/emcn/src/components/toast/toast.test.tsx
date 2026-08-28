/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider, toast } from './toast'

const navigation = vi.hoisted(() => ({
  pathname: '/workspace/workspace-1/home',
}))

vi.mock('next/navigation', () => ({ usePathname: () => navigation.pathname }))

let root: Root | null = null
let container: HTMLDivElement | null = null

function mountProvider(children?: ReactNode): void {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<ToastProvider>{children}</ToastProvider>))
}

beforeEach(() => {
  navigation.pathname = '/workspace/workspace-1/home'
  vi.stubGlobal(
    'ResizeObserver',
    class {
      disconnect(): void {}
      observe(): void {}
    }
  )
})

afterEach(() => {
  if (root) act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  vi.unstubAllGlobals()
})

describe('ToastProvider', () => {
  it('does not dismiss a route-mounted toast before it commits', () => {
    mountProvider()
    const onDismiss = vi.fn()

    function RouteToast() {
      useEffect(() => {
        toast.info('Ready on the new route', { onDismiss, duration: 0 })
      }, [])
      return null
    }

    navigation.pathname = '/workspace/workspace-1/settings'
    act(() =>
      root?.render(
        <ToastProvider>
          <RouteToast />
        </ToastProvider>
      )
    )

    expect(onDismiss).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Ready on the new route')

    act(() => toast.dismissAll())
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('runs dismissal cleanup once when an action closes the toast', () => {
    mountProvider()
    const onDismiss = vi.fn()
    const onAction = vi.fn()

    act(() => {
      toast.info('Permission requested', {
        action: { label: 'Allow', onClick: onAction },
        onDismiss,
      })
    })

    const action = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent === 'Allow'
    )
    const dismiss = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Dismiss notification"]'
    )
    expect(action).not.toBeUndefined()
    expect(dismiss).not.toBeNull()
    act(() => action?.click())
    expect(onAction).toHaveBeenCalledOnce()
    expect(onDismiss).toHaveBeenCalledOnce()
    act(() => dismiss?.click())

    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('runs dismissal cleanup for programmatic removal', () => {
    mountProvider()
    const onDismiss = vi.fn()
    let id = ''

    act(() => {
      id = toast.info('Permission requested', { onDismiss, duration: 0 })
    })
    act(() => toast.dismiss(id))

    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('runs dismissal cleanup when a toast is added and removed in one batch', () => {
    mountProvider()
    const onDismiss = vi.fn()
    let id = ''

    act(() => {
      id = toast.info('Permission requested', { onDismiss, duration: 0 })
      toast.dismiss(id)
    })

    expect(onDismiss).toHaveBeenCalledOnce()
    act(() => toast.dismiss(id))
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('runs dismissal cleanup when stack admission evicts an uncommitted toast', () => {
    mountProvider()
    const onDismiss = vi.fn()

    act(() => {
      toast.info('First', { onDismiss })
      toast.info('Second')
      toast.info('Third')
      toast.info('Fourth')
    })

    expect(onDismiss).toHaveBeenCalledOnce()
    expect(document.body.textContent).not.toContain('First')
  })
})
