/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PEEK_CLOSE_DELAY_MS as CLOSE_DELAY_MS,
  PEEK_EXIT_DURATION_MS as EXIT_DURATION_MS,
  PEEK_OPEN_DELAY_MS as OPEN_DELAY_MS,
  PEEK_POINTER_SAMPLE_MS as POINTER_SAMPLE_MS,
  useSidebarPeek,
} from '@/app/workspace/[workspaceId]/components/workspace-chrome/use-sidebar-peek'

/**
 * Screen geometry the hook hit-tests against. jsdom gives every element a zero
 * rect, so the harness stubs these — without them every coordinate falls inside
 * the card's 0×0 box (padded by the gap tolerance) and the peek never retracts.
 * Values mirror the real desktop layout: a 32px toggle in the title-bar lane, and
 * the card inset 8px from the left starting below that lane.
 */
const TRIGGER_RECT = { left: 78, top: 4, right: 110, bottom: 36 }
const CARD_RECT = { left: 8, top: 40, right: 258, bottom: 852 }

/** Points used by the tests, in client coordinates. */
const POINT = {
  onTrigger: [94, 20],
  inCard: [120, 300],
  inGap: [100, 38],
  onContent: [800, 400],
} as const

function stubRect(
  element: HTMLElement,
  rect: { left: number; top: number; right: number; bottom: number }
) {
  element.getBoundingClientRect = () =>
    ({
      ...rect,
      x: rect.left,
      y: rect.top,
      width: rect.right - rect.left,
      height: rect.bottom - rect.top,
      toJSON: () => rect,
    }) as DOMRect
}

interface Harness {
  state: () => { isPeekActive: boolean; isPeekOpen: boolean }
  triggerEnter: () => void
  triggerLeave: () => void
  setEnabled: (enabled: boolean) => void
  setDismissed: (dismissed: boolean) => void
  unmount: () => void
}

/**
 * Minimal dependency-free hook harness (the repo has no `@testing-library/react`).
 * Mounts the hook in a real React root under jsdom so the refs point at live nodes,
 * then stubs their rects — the close hit-test reads geometry off those refs.
 */
function renderPeek(initialEnabled: boolean): Harness {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root: Root = createRoot(container)

  let latest = { isPeekActive: false, isPeekOpen: false }
  let onTriggerEnter = () => {}
  let onTriggerLeave = () => {}

  function Probe({ enabled, dismissed }: { enabled: boolean; dismissed: boolean }) {
    const peek = useSidebarPeek(enabled, dismissed)
    latest = { isPeekActive: peek.isPeekActive, isPeekOpen: peek.isPeekOpen }
    onTriggerEnter = peek.onTriggerEnter
    onTriggerLeave = peek.onTriggerLeave
    return (
      <div>
        <div data-probe='trigger' ref={peek.triggerRef} />
        <div data-probe='card' ref={peek.cardRef} />
      </div>
    )
  }

  let props = { enabled: initialEnabled, dismissed: false }
  const render = (next: Partial<typeof props>) => {
    props = { ...props, ...next }
    act(() => {
      root.render(<Probe enabled={props.enabled} dismissed={props.dismissed} />)
    })
  }
  render({})

  const query = (name: string) =>
    container.querySelector<HTMLElement>(`[data-probe="${name}"]`) as HTMLElement

  stubRect(query('card'), CARD_RECT)
  stubRect(query('trigger'), TRIGGER_RECT)

  return {
    state: () => latest,
    triggerEnter: () => onTriggerEnter(),
    triggerLeave: () => onTriggerLeave(),
    setEnabled: (enabled: boolean) => render({ enabled }),
    setDismissed: (dismissed: boolean) => render({ dismissed }),
    unmount: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

/**
 * Dispatches a pointer move at client coordinates. `target` only matters for the
 * portal check — the card and trigger are matched by geometry. Each call advances the
 * clock past the hook's sample floor so consecutive moves are never coalesced.
 */
function movePointerTo([x, y]: readonly [number, number], target: Element = document.body) {
  act(() => {
    vi.advanceTimersByTime(POINTER_SAMPLE_MS)
    target.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: x, clientY: y }))
  })
}

function openPeek(harness: Harness) {
  act(() => {
    harness.triggerEnter()
    vi.advanceTimersByTime(OPEN_DELAY_MS)
  })
}

let active: Harness | null = null
const appended: Element[] = []

/**
 * Appends a portal-like node to `document.body`, standing in for a menu or tooltip
 * the sidebar renders outside the card. Tracked for teardown so a failing assertion
 * can never leak a node into the next test.
 */
async function appendToBody(tag: string, attributes: Record<string, string>) {
  const node = document.createElement(tag)
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value)
  appended.push(node)
  await act(async () => {
    document.body.appendChild(node)
  })
  return node
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({ matches: false }) as unknown as typeof matchMedia
  )
})

afterEach(() => {
  active?.unmount()
  active = null
  for (const node of appended.splice(0)) node.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useSidebarPeek', () => {
  it('opens only after the hover dwell elapses', () => {
    active = renderPeek(true)

    act(() => {
      active?.triggerEnter()
      vi.advanceTimersByTime(OPEN_DELAY_MS - 1)
    })
    expect(active.state().isPeekActive).toBe(false)

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(active.state().isPeekActive).toBe(true)
    expect(active.state().isPeekOpen).toBe(true)
  })

  it('does not open when the pointer leaves before the dwell elapses', () => {
    active = renderPeek(true)

    act(() => {
      active?.triggerEnter()
      vi.advanceTimersByTime(OPEN_DELAY_MS - 10)
      active?.triggerLeave()
      vi.advanceTimersByTime(OPEN_DELAY_MS)
    })

    expect(active.state().isPeekActive).toBe(false)
  })

  it('never opens while disabled', () => {
    active = renderPeek(false)

    act(() => {
      active?.triggerEnter()
      vi.advanceTimersByTime(OPEN_DELAY_MS * 5)
    })

    expect(active.state().isPeekActive).toBe(false)
  })

  it('stays open while the pointer is inside the card', () => {
    active = renderPeek(true)
    openPeek(active)

    movePointerTo(POINT.inCard)
    act(() => {
      vi.advanceTimersByTime(CLOSE_DELAY_MS * 3)
    })

    expect(active.state().isPeekOpen).toBe(true)
  })

  it('stays open while the pointer is still over the toggle that opened it', () => {
    active = renderPeek(true)
    openPeek(active)

    movePointerTo(POINT.onTrigger)
    act(() => {
      vi.advanceTimersByTime(CLOSE_DELAY_MS * 3)
    })

    expect(active.state().isPeekOpen).toBe(true)
  })

  it('stays open while the pointer is over a portalled popper', async () => {
    active = renderPeek(true)
    openPeek(active)

    const overlay = await appendToBody('div', { 'data-radix-popper-content-wrapper': '' })

    movePointerTo(POINT.onContent, overlay)
    act(() => {
      vi.advanceTimersByTime(CLOSE_DELAY_MS * 3)
    })

    expect(active.state().isPeekOpen).toBe(true)
  })

  it('retracts after the grace period once the pointer moves to content', () => {
    active = renderPeek(true)
    openPeek(active)

    movePointerTo(POINT.onContent)
    expect(active.state().isPeekOpen).toBe(true)

    act(() => {
      vi.advanceTimersByTime(CLOSE_DELAY_MS)
    })
    expect(active.state().isPeekOpen).toBe(false)
    // Stays mounted so the fade-out can play.
    expect(active.state().isPeekActive).toBe(true)

    act(() => {
      vi.advanceTimersByTime(EXIT_DURATION_MS)
    })
    expect(active.state().isPeekActive).toBe(false)
  })

  it('stays open while crossing the gap between the toggle and the card', () => {
    active = renderPeek(true)
    openPeek(active)

    movePointerTo(POINT.inGap)
    act(() => {
      vi.advanceTimersByTime(CLOSE_DELAY_MS * 2)
    })

    expect(active.state().isPeekOpen).toBe(true)
  })

  it('cancels a pending retraction when the pointer returns', () => {
    active = renderPeek(true)
    openPeek(active)

    movePointerTo(POINT.onContent)
    act(() => {
      vi.advanceTimersByTime(CLOSE_DELAY_MS - 20)
    })
    movePointerTo(POINT.inCard)
    act(() => {
      vi.advanceTimersByTime(CLOSE_DELAY_MS * 2)
    })

    expect(active.state().isPeekOpen).toBe(true)
  })

  it('does not open on hover while a modal is already open', () => {
    active = renderPeek(true)
    active.setDismissed(true)

    openPeek(active)

    expect(active.state().isPeekActive).toBe(false)
  })

  it('retracts when a modal opens, even with the pointer inside', () => {
    active = renderPeek(true)
    openPeek(active)
    movePointerTo(POINT.inCard)

    active.setDismissed(true)

    expect(active.state().isPeekOpen).toBe(false)
  })

  it('keeps the peek open while the pointer is over a non-modal popper', async () => {
    active = renderPeek(true)
    openPeek(active)

    const popper = await appendToBody('div', { 'data-radix-popper-content-wrapper': '' })
    movePointerTo(POINT.onContent, popper)
    act(() => {
      vi.advanceTimersByTime(CLOSE_DELAY_MS * 2)
    })

    expect(active.state().isPeekOpen).toBe(true)
  })

  /**
   * Regression: a modal's scrim is `fixed inset-0` and carries emcn's
   * `data-native-surface-overlay` marker, so matching that marker made every pointer
   * position read as "inside a popper" and pinned the card open for good. Only Radix's
   * popper wrapper counts.
   */
  it('retracts even while a full-screen modal scrim is present', () => {
    active = renderPeek(true)
    openPeek(active)

    const scrim = document.createElement('div')
    scrim.setAttribute('data-native-surface-overlay', '')
    appended.push(scrim)
    document.body.appendChild(scrim)

    movePointerTo(POINT.onContent, scrim)
    act(() => {
      vi.advanceTimersByTime(CLOSE_DELAY_MS)
    })

    expect(active.state().isPeekOpen).toBe(false)
  })

  it('leaves Escape to an open popper rather than retracting', async () => {
    active = renderPeek(true)
    openPeek(active)
    // Radix nests the state-bearing content inside the wrapper; only an *open* one
    // claims Escape, so a menu animating closed still lets the card retract.
    const wrapper = await appendToBody('div', { 'data-radix-popper-content-wrapper': '' })
    const content = document.createElement('div')
    content.setAttribute('data-state', 'open')
    wrapper.appendChild(content)

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })

    expect(active.state().isPeekOpen).toBe(true)
  })

  it('retracts on Escape when a popper is only animating closed', async () => {
    active = renderPeek(true)
    openPeek(active)
    const wrapper = await appendToBody('div', { 'data-radix-popper-content-wrapper': '' })
    const content = document.createElement('div')
    content.setAttribute('data-state', 'closed')
    wrapper.appendChild(content)

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })

    expect(active.state().isPeekOpen).toBe(false)
  })

  it('retracts on Escape', () => {
    active = renderPeek(true)
    openPeek(active)

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })

    expect(active.state().isPeekOpen).toBe(false)
  })

  it('drops the peek immediately when it stops being enabled', () => {
    active = renderPeek(true)
    openPeek(active)

    active.setEnabled(false)

    expect(active.state().isPeekOpen).toBe(false)
    expect(active.state().isPeekActive).toBe(false)
  })

  it('opens under reduced motion', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({ matches: true }) as unknown as typeof matchMedia
    )
    active = renderPeek(true)

    act(() => {
      active?.triggerEnter()
      vi.advanceTimersByTime(OPEN_DELAY_MS)
    })

    expect(active.state().isPeekActive).toBe(true)
    expect(active.state().isPeekOpen).toBe(true)
  })
})
