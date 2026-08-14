/**
 * @vitest-environment jsdom
 *
 * A "port" on a card is a swell painted into the border silhouette, not a DOM
 * node, so nothing about drawing one forces a handle to exist behind it. These
 * cover the two directions independently: a card that mounts no source handle
 * must not raise a swell under its own hover, and a card that mounts no target
 * handle must not raise one under a connection dragged from somewhere else.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkflowBlockBorder, type WorkflowBorderPort } from '../index'

const CARD = { left: 200, top: 100, width: 350, height: 120 }
const CARD_RECT = {
  left: CARD.left,
  top: CARD.top,
  right: CARD.left + CARD.width,
  bottom: CARD.top + CARD.height,
  width: CARD.width,
  height: CARD.height,
  x: CARD.left,
  y: CARD.top,
  toJSON: () => ({}),
} as DOMRect

/** Where a source knob sits. */
const RIGHT_EDGE = { x: CARD.left + CARD.width, y: CARD.top + CARD.height / 2 }
/** Where a target knob sits. */
const LEFT_EDGE = { x: CARD.left, y: CARD.top + CARD.height / 2 }

/*
 * The phantom swell these cover is the pointer-following one, which forms
 * anywhere on the perimeter; leaving knobs out keeps it from magnetizing into
 * one and handing the handle off, which is a different path.
 */
const PORTS: WorkflowBorderPort[] = []

const mountedRoots = new Set<Root>()
const mountedHosts = new Set<HTMLDivElement>()

beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
})

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(performance.now()), 16)
  )
  vi.stubGlobal('cancelAnimationFrame', (frameId: number) => window.clearTimeout(frameId))
})

afterEach(() => {
  act(() => {
    mountedRoots.forEach((root) => root.unmount())
  })
  mountedRoots.clear()
  mountedHosts.forEach((host) => host.remove())
  mountedHosts.clear()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

interface MountOptions {
  connectionNodeId?: string | null
  canStartConnection?: boolean
  canReceiveConnection?: boolean
}

function mountBorder({
  connectionNodeId = null,
  canStartConnection,
  canReceiveConnection,
}: MountOptions) {
  const onCursorHandleChange = vi.fn()
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mountedRoots.add(root)
  mountedHosts.add(host)

  act(() => {
    root.render(
      <WorkflowBlockBorder
        nodeId='block-1'
        getConnectionNodeId={() => connectionNodeId}
        ports={PORTS}
        canStartConnection={canStartConnection}
        canReceiveConnection={canReceiveConnection}
        hasRing={false}
        ringStyles=''
        width={CARD.width}
        height={CARD.height}
        onCursorHandleChange={onCursorHandleChange}
      />
    )
  })

  /*
   * The tracker measures the swell host — the SVG's parent — and jsdom lays
   * nothing out, so the card's box has to be supplied.
   */
  const svg = host.querySelector('svg')
  const swellHost = svg?.parentElement
  if (!swellHost) throw new Error('border did not mount')
  swellHost.getBoundingClientRect = () => CARD_RECT
  host.getBoundingClientRect = () => CARD_RECT
  document.elementFromPoint = () => swellHost

  onCursorHandleChange.mockClear()
  return { swellHost, onCursorHandleChange }
}

function pointerEvent(type: string, x: number, y: number) {
  return new MouseEvent(type, {
    bubbles: true,
    clientX: x,
    clientY: y,
  }) as unknown as PointerEvent
}

/**
 * Handles the border actually offered. A `null` call is the tracker reporting
 * "no swell", which is the very state these assert, so counting bare calls
 * would read a correct teardown as a phantom port.
 */
function offeredHandles(spy: ReturnType<typeof vi.fn>) {
  return spy.mock.calls.filter(([handle]) => handle != null)
}

/** Runs the spring far enough for the swell to reach the drawn threshold. */
function advanceSprings() {
  act(() => {
    vi.advanceTimersByTime(500)
  })
}

describe('WorkflowBlockBorder connectability', () => {
  it('raises a swell under its own hover by default', () => {
    const { swellHost, onCursorHandleChange } = mountBorder({})

    act(() => {
      swellHost.dispatchEvent(pointerEvent('pointerenter', RIGHT_EDGE.x, RIGHT_EDGE.y))
      window.dispatchEvent(pointerEvent('pointermove', RIGHT_EDGE.x, RIGHT_EDGE.y))
    })
    advanceSprings()

    expect(offeredHandles(onCursorHandleChange).length).toBeGreaterThan(0)
  })

  it('raises no swell under its own hover when it can start no connection', () => {
    const { swellHost, onCursorHandleChange } = mountBorder({ canStartConnection: false })

    act(() => {
      swellHost.dispatchEvent(pointerEvent('pointerenter', RIGHT_EDGE.x, RIGHT_EDGE.y))
      window.dispatchEvent(pointerEvent('pointermove', RIGHT_EDGE.x, RIGHT_EDGE.y))
    })
    advanceSprings()

    expect(offeredHandles(onCursorHandleChange)).toHaveLength(0)
  })

  it('raises a swell under a connection dragged from another card by default', () => {
    const { onCursorHandleChange } = mountBorder({ connectionNodeId: 'other-block' })

    act(() => {
      window.dispatchEvent(pointerEvent('pointermove', LEFT_EDGE.x, LEFT_EDGE.y))
    })
    advanceSprings()

    expect(offeredHandles(onCursorHandleChange).length).toBeGreaterThan(0)
  })

  it('raises no swell under a foreign drag when it can receive no connection', () => {
    const { onCursorHandleChange } = mountBorder({
      connectionNodeId: 'other-block',
      canReceiveConnection: false,
    })

    act(() => {
      window.dispatchEvent(pointerEvent('pointermove', LEFT_EDGE.x, LEFT_EDGE.y))
    })
    advanceSprings()

    expect(offeredHandles(onCursorHandleChange)).toHaveLength(0)
  })
})
