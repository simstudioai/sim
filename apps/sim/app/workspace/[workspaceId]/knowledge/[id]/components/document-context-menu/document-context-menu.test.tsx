/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DocumentContextMenu } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/document-context-menu/document-context-menu'

class ResizeObserverMock {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverMock)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe('DocumentContextMenu retry', () => {
  it('offers an accessible Retry action and invokes the provided handler on selection', () => {
    const onRetry = vi.fn()
    const onClose = vi.fn()

    act(() => {
      root.render(
        <DocumentContextMenu
          isOpen
          position={{ x: 0, y: 0 }}
          onClose={onClose}
          hasDocument
          selectedCount={1}
          onRetry={onRetry}
        />
      )
    })

    const item = document.body.querySelector<HTMLElement>('[role="menuitem"]')
    expect(item).toHaveAccessibleName('Retry')
    expect(item).not.toHaveAttribute('aria-disabled', 'true')

    act(() => item?.click())

    expect(onRetry).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it.each([
    { scenario: 'no retry handler', selectedCount: 1, hasDocument: true, canRetry: false },
    { scenario: 'multiple documents', selectedCount: 2, hasDocument: true, canRetry: true },
    { scenario: 'empty space', selectedCount: 0, hasDocument: false, canRetry: true },
  ])('does not offer Retry for $scenario', ({ selectedCount, hasDocument, canRetry }) => {
    const onRetry = vi.fn()

    act(() => {
      root.render(
        <DocumentContextMenu
          isOpen
          position={{ x: 0, y: 0 }}
          onClose={vi.fn()}
          hasDocument={hasDocument}
          selectedCount={selectedCount}
          onRetry={canRetry ? onRetry : undefined}
        />
      )
    })

    expect(document.body.querySelector('[role="menuitem"]')).toBeNull()
    expect(onRetry).not.toHaveBeenCalled()
  })
})
