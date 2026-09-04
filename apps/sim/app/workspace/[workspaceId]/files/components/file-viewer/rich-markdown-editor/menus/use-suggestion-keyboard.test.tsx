/** @vitest-environment jsdom */
import { act, Suspense, startTransition, useLayoutEffect, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSuggestionKeyboard } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/menus/use-suggestion-keyboard'

describe('suggestion keyboard committed state', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    vi.unstubAllGlobals()
  })

  it.each([
    ['items', 'Enter'],
    ['items', 'Tab'],
    ['callback', 'Enter'],
    ['callback', 'Tab'],
    ['activeIndex', 'Enter'],
    ['activeIndex', 'Tab'],
  ] as const)('uses committed %s when %s follows a suspended render', async (change, key) => {
    const items = ['Visible first', 'Visible second']
    const suspendedItems = ['Uncommitted first', 'Uncommitted second']
    const onSelect = vi.fn()
    const suspendedOnSelect = vi.fn()
    const pending = new Promise<void>(() => {})
    let attemptedSuspension = false
    let committed!: ReturnType<typeof useSuggestionKeyboard<string>>

    interface ProbeProps {
      suspended: boolean
    }

    function Probe({ suspended }: ProbeProps) {
      const containerRef = useRef<HTMLElement>(null)
      const keyboard = useSuggestionKeyboard(
        suspended && change === 'items' ? suspendedItems : items,
        suspended && change === 'callback' ? suspendedOnSelect : onSelect,
        containerRef
      )
      useLayoutEffect(() => {
        committed = keyboard
      })
      if (suspended) {
        attemptedSuspension = true
        throw pending
      }
      return <div>{items[keyboard.activeIndex]}</div>
    }

    const view = (suspended: boolean) => (
      <Suspense fallback={<div>Loading</div>}>
        <Probe suspended={suspended} />
      </Suspense>
    )

    await act(async () => root.render(view(false)))
    const capturedHandler = committed.onKeyDown
    await act(async () => committed.setActiveIndex(1))
    expect(committed.onKeyDown).toBe(capturedHandler)

    await act(async () => {
      startTransition(() => {
        if (change === 'activeIndex') committed.setActiveIndex(0)
        root.render(view(true))
      })
    })
    expect(attemptedSuspension).toBe(true)
    expect(host.textContent).toBe('Visible second')
    expect(committed.onKeyDown).toBe(capturedHandler)
    act(() => {
      expect(capturedHandler({ event: new KeyboardEvent('keydown', { key }) })).toBe(true)
    })
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('Visible second')
    expect(suspendedOnSelect).not.toHaveBeenCalled()
  })
})
