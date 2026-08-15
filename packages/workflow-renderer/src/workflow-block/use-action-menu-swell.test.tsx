/**
 * @vitest-environment jsdom
 *
 * The action bar floats above the card, so the pointer crosses a gap to reach
 * it and the card's own `pointerleave` fires on the way out. The hook tracks
 * the pointer across that gap — and the tracking listener is the only thing
 * still watching once the pointer is off the node, because no further
 * `pointerleave` can arrive.
 */

import { act, useEffect } from 'react'
import { sleep } from '@sim/utils/helpers'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { useActionMenuSwell } from './use-action-menu-swell'

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

/** Clears the hook's 100ms hover-leave delay and its 40ms swell close with margin. */
const SETTLE_PASS_MS = 160
const ACTION_MENU_RECT = { left: 100, right: 240, top: 40, bottom: 70 }
/** Comfortably outside the bar's hover band, which extends 28px above `top`. */
const AWAY_POINT = { clientX: 600, clientY: 400 }

let container: HTMLDivElement | null = null
let root: Root | null = null

interface HarnessProps {
  onState: (state: { swellOpen: boolean }) => void
}

/**
 * Mounts the hook under a `.react-flow__node` ancestor, since the hook binds
 * its hover listeners to that element rather than to its own root.
 */
function Harness({ onState }: HarnessProps) {
  const { rootRef, swellOpen } = useActionMenuSwell({ enabled: true, forceOpen: false })

  useEffect(() => {
    onState({ swellOpen })
  }, [onState, swellOpen])

  return (
    <div className='react-flow__node'>
      <div ref={rootRef} data-testid='action-menu' />
    </div>
  )
}

function mount(onState: (state: { swellOpen: boolean }) => void) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root?.render(<Harness onState={onState} />)
  })

  const node = container.querySelector<HTMLElement>('.react-flow__node')
  const menu = container.querySelector<HTMLElement>('[data-testid="action-menu"]')
  if (!node || !menu) throw new Error('harness did not mount')

  menu.getBoundingClientRect = () =>
    ({
      ...ACTION_MENU_RECT,
      width: ACTION_MENU_RECT.right - ACTION_MENU_RECT.left,
      height: ACTION_MENU_RECT.bottom - ACTION_MENU_RECT.top,
      x: ACTION_MENU_RECT.left,
      y: ACTION_MENU_RECT.top,
      toJSON: () => ({}),
    }) as DOMRect

  return { node, menu }
}

function pointerEvent(type: string, init: PointerEventInit) {
  return new MouseEvent(type, { bubbles: true, ...init }) as unknown as PointerEvent
}

/**
 * Drains the two chained timers the retract runs on: the 100ms hover-leave
 * delay, then the 40ms swell close that its state change schedules. They need
 * separate `act` passes — effects only flush when `act` exits, so the second
 * timer is not even created until the first pass is over.
 */
async function settle() {
  for (let pass = 0; pass < 2; pass++) {
    await act(async () => {
      await sleep(SETTLE_PASS_MS)
    })
  }
}

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  root = null
  container?.remove()
  container = null
})

describe('useActionMenuSwell', () => {
  it('retracts after the pointer crosses the bar and keeps going', async () => {
    let state = { swellOpen: false }
    const { node } = mount((next) => {
      state = next
    })

    act(() => {
      node.dispatchEvent(pointerEvent('pointerenter', {}))
    })
    expect(state.swellOpen).toBe(true)

    act(() => {
      node.dispatchEvent(pointerEvent('pointerleave', {}))
    })

    /*
     * One move lands inside the bar's hover band on the way out. This is the
     * regression: it used to cancel the retract AND tear down the tracker, so
     * nothing was left to close the bar once the pointer carried on.
     */
    act(() => {
      window.dispatchEvent(pointerEvent('pointermove', { clientX: 150, clientY: 50 }))
    })
    expect(state.swellOpen).toBe(true)

    act(() => {
      window.dispatchEvent(pointerEvent('pointermove', AWAY_POINT))
    })

    await settle()

    expect(state.swellOpen).toBe(false)
  })

  it('stays open while the pointer rests on the bar', async () => {
    let state = { swellOpen: false }
    const { node } = mount((next) => {
      state = next
    })

    act(() => {
      node.dispatchEvent(pointerEvent('pointerenter', {}))
      node.dispatchEvent(pointerEvent('pointerleave', {}))
    })

    act(() => {
      window.dispatchEvent(pointerEvent('pointermove', { clientX: 150, clientY: 50 }))
    })

    await settle()

    expect(state.swellOpen).toBe(true)
  })
})
