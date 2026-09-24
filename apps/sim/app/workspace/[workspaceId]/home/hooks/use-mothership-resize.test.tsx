/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import {
  type DragGeometry,
  dividerXAt,
  KEYBOARD_STEP_PX,
  keyboardPanelWidth,
  maxPanelWidth,
  panelWidthAt,
  useMothershipResize,
} from '@/app/workspace/[workspaceId]/home/hooks/use-mothership-resize'
import { MOTHERSHIP_WIDTH } from '@/stores/constants'

vi.mock('@/lib/browser-agent/transport', () => ({ beginBrowserPanelDividerDrag: () => null }))

/**
 * The workspace chrome insets the panel from the viewport edge by its padding
 * (8px) plus its border (1px), so a 1512px window puts the panel's right edge
 * at 1503 — the number the whole coordinate frame hangs on.
 */
const VIEWPORT = 1512
const PANEL_RIGHT = VIEWPORT - 9
const CONTAINER = 1254

function geometry(overrides: Partial<DragGeometry> = {}): DragGeometry {
  return {
    panelRight: PANEL_RIGHT,
    grabOffset: 0,
    maxWidth: maxPanelWidth(VIEWPORT, CONTAINER),
    ...overrides,
  }
}

describe('maxPanelWidth', () => {
  it('yields to the chat column when its min-width is the tighter ceiling', () => {
    // 1512 * 0.8 = 1209.6, but the chat's 240px floor only leaves 1014.
    expect(maxPanelWidth(VIEWPORT, CONTAINER)).toBe(CONTAINER - MOTHERSHIP_WIDTH.CHAT_MIN)
  })

  it('yields to the viewport share when the container is roomy', () => {
    expect(maxPanelWidth(VIEWPORT, 4000)).toBe(VIEWPORT * MOTHERSHIP_WIDTH.MAX_PERCENTAGE)
  })

  it('never returns less than the panel minimum', () => {
    // Minimum window size with the sidebar expanded cannot satisfy both.
    expect(maxPanelWidth(800, 500)).toBe(MOTHERSHIP_WIDTH.MIN)
  })
})

describe('panelWidthAt', () => {
  it('measures the width from the panel edge, not the viewport edge', () => {
    // Dragging to clientX leaves panelRight - clientX of panel, so a pointer at
    // the container's midpoint must not produce a viewport-relative width.
    expect(panelWidthAt(1000, geometry())).toBe(PANEL_RIGHT - 1000)
    expect(panelWidthAt(1000, geometry())).not.toBe(VIEWPORT - 1000)
  })

  it('honours the grab offset so the edge does not jump to the cursor', () => {
    const grabbed = geometry({ grabOffset: 4 })
    expect(panelWidthAt(1000, grabbed)).toBe(PANEL_RIGHT - 996)
  })

  it('clamps to the minimum and the maximum', () => {
    expect(panelWidthAt(PANEL_RIGHT, geometry())).toBe(MOTHERSHIP_WIDTH.MIN)
    expect(panelWidthAt(0, geometry())).toBe(maxPanelWidth(VIEWPORT, CONTAINER))
  })
})

describe('dividerXAt', () => {
  /**
   * The invariant the native browser view depends on: the divider position
   * reported to the desktop shell is exactly where the width write puts the
   * panel's left edge. When these drifted apart the shell composited the page
   * beside the panel rather than on it, leaving a band of panel background that
   * flickered as predicted and measured rects alternated each frame.
   */
  it('always agrees with the edge the width write produces', () => {
    for (const grabOffset of [-4, 0, 4]) {
      const g = geometry({ grabOffset })
      for (let clientX = 0; clientX <= VIEWPORT; clientX += 7) {
        expect(dividerXAt(clientX, g)).toBe(g.panelRight - panelWidthAt(clientX, g))
      }
    }
  })

  it('tracks the pointer while both clamps are slack', () => {
    expect(dividerXAt(1000, geometry())).toBe(1000)
  })

  it('stops at the edge the chat column pins it to, and goes no further', () => {
    const g = geometry()
    const pinned = g.panelRight - maxPanelWidth(VIEWPORT, CONTAINER)
    // Past the ceiling the divider must hold still. It used to keep travelling,
    // because the width ceiling ignored the chat's min-width while the flex row
    // did not — a dead band in which the panel froze but the reported divider,
    // and with it the native view, kept moving left.
    expect(dividerXAt(pinned, g)).toBe(pinned)
    expect(dividerXAt(pinned - 60, g)).toBe(pinned)
  })

  it('never reports a divider outside the panel', () => {
    const g = geometry()
    for (let clientX = -200; clientX <= VIEWPORT + 200; clientX += 13) {
      const x = dividerXAt(clientX, g)
      expect(x).toBeLessThanOrEqual(g.panelRight - MOTHERSHIP_WIDTH.MIN)
      expect(x).toBeGreaterThanOrEqual(g.panelRight - g.maxWidth)
    }
  })
})

describe('keyboardPanelWidth', () => {
  const max = maxPanelWidth(VIEWPORT, CONTAINER)

  it('moves the divider the way the arrow points', () => {
    expect(keyboardPanelWidth('left', 600, max)).toBe(600 + KEYBOARD_STEP_PX)
    expect(keyboardPanelWidth('right', 600, max)).toBe(600 - KEYBOARD_STEP_PX)
  })

  it('clamps arrow steps to the same bounds as the drag', () => {
    expect(keyboardPanelWidth('right', MOTHERSHIP_WIDTH.MIN + 1, max)).toBe(MOTHERSHIP_WIDTH.MIN)
    expect(keyboardPanelWidth('left', max - 1, max)).toBe(max)
  })

  it('jumps to the narrowest and widest panel on Home and End', () => {
    expect(keyboardPanelWidth('min', 600, max)).toBe(MOTHERSHIP_WIDTH.MIN)
    expect(keyboardPanelWidth('max', 600, max)).toBe(max)
  })
})

describe('useMothershipResize keyboard divider', () => {
  async function mountDivider() {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    function Harness() {
      const { mothershipRef, handleResizeKeyDown, handleResizeFocus } = useMothershipResize('s')
      return (
        <div data-testid='row'>
          <div
            role='separator'
            tabIndex={0}
            onKeyDown={handleResizeKeyDown}
            onFocus={handleResizeFocus}
          />
          <div ref={mothershipRef} data-testid='panel' />
        </div>
      )
    }
    await act(async () => root.render(<Harness />))
    const separator = container.querySelector<HTMLDivElement>('[role="separator"]')!
    const panel = container.querySelector<HTMLDivElement>('[data-testid="panel"]')!
    Object.defineProperty(panel.parentElement!, 'clientWidth', { value: CONTAINER })
    vi.stubGlobal('innerWidth', VIEWPORT)
    panel.getBoundingClientRect = () => {
      const width = Number.parseFloat(panel.style.width) || 600
      return { width, left: PANEL_RIGHT - width, right: PANEL_RIGHT } as DOMRect
    }
    const press = (key: string, init: KeyboardEventInit = {}) => {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
      act(() => {
        separator.dispatchEvent(event)
      })
      return event
    }
    const unmount = async () => {
      await act(async () => root.unmount())
      container.remove()
      vi.unstubAllGlobals()
    }
    return { separator, panel, press, unmount }
  }

  it('steps and clamps the panel width through the drag clamps and reports it', async () => {
    const { separator, panel, press, unmount } = await mountDivider()
    const max = maxPanelWidth(VIEWPORT, CONTAINER)

    await act(async () => separator.focus())
    expect(separator.getAttribute('aria-valuenow')).toBe('600')
    expect(separator.getAttribute('aria-valuemin')).toBe(String(MOTHERSHIP_WIDTH.MIN))
    expect(separator.getAttribute('aria-valuemax')).toBe(String(Math.round(max)))

    expect(press('ArrowLeft').defaultPrevented).toBe(true)
    expect(panel.style.width).toBe(`${600 + KEYBOARD_STEP_PX}px`)
    expect(separator.getAttribute('aria-valuenow')).toBe(String(600 + KEYBOARD_STEP_PX))
    expect(panel.style.transition).toBe('')

    press('End')
    expect(panel.style.width).toBe(`${max}px`)
    press('Home')
    expect(panel.style.width).toBe(`${MOTHERSHIP_WIDTH.MIN}px`)
    press('ArrowRight')
    expect(panel.style.width).toBe(`${MOTHERSHIP_WIDTH.MIN}px`)
    await unmount()
  })

  it('leaves modified and unrelated keys to the rest of the page', async () => {
    const { panel, press, unmount } = await mountDivider()
    for (const event of [
      press('ArrowLeft', { metaKey: true }),
      press('ArrowLeft', { shiftKey: true }),
      press('Tab'),
      press('Enter'),
    ]) {
      expect(event.defaultPrevented).toBe(false)
    }
    expect(panel.style.width).toBe('')
    await unmount()
  })
})
