/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSidebarResize } from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks/use-sidebar-resize'
import { useSidebarStore } from '@/stores/sidebar/store'

let container: HTMLDivElement
let root: Root

function ResizeHandle() {
  const { handlePointerDown } = useSidebarResize()
  return <div role='separator' onPointerDown={handlePointerDown} />
}

beforeEach(() => {
  vi.useFakeTimers()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  useSidebarStore.setState({ isCollapsed: false, sidebarWidth: 256 })
  container = document.createElement('div')
  container.className = 'sidebar-shell-outer'
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<ResizeHandle />))
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
})

function startResize() {
  const handle = container.querySelector('[role="separator"]')!
  act(() => handle.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })))
  expect(container.hasAttribute('data-resizing')).toBe(true)
}

describe('sidebar resize lifecycle', () => {
  it.each(['pointerup', 'pointercancel', 'blur', 'unmount'])(
    'restores animation and persists the final width after %s',
    (event) => {
      startResize()
      act(() => {
        document.dispatchEvent(new MouseEvent('pointermove', { clientX: 280 }))
        vi.advanceTimersByTime(20)
      })
      expect(container.style.getPropertyValue('--sidebar-width')).toBe('280px')
      expect(useSidebarStore.getState().sidebarWidth).toBe(256)

      act(() => {
        if (event === 'unmount') root.render(null)
        else if (event === 'blur') window.dispatchEvent(new Event(event))
        else document.dispatchEvent(new Event(event))
      })

      expect(container.hasAttribute('data-resizing')).toBe(false)
      expect(container.style.getPropertyValue('--sidebar-width')).toBe('')
      expect(useSidebarStore.getState().sidebarWidth).toBe(280)
      expect(document.body.style.cursor).toBe('')
      expect(document.body.style.userSelect).toBe('')
    }
  )

  it('restores animation when released without moving', () => {
    startResize()
    act(() => document.dispatchEvent(new Event('pointerup')))
    expect(container.hasAttribute('data-resizing')).toBe(false)
    expect(useSidebarStore.getState().sidebarWidth).toBe(256)
  })
})
