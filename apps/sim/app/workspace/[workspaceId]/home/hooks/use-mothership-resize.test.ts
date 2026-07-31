/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  type DragGeometry,
  dividerXAt,
  maxPanelWidth,
  panelWidthAt,
} from '@/app/workspace/[workspaceId]/home/hooks/use-mothership-resize'
import { MOTHERSHIP_WIDTH } from '@/stores/constants'

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
    // 1512 * 0.65 = 982.8, but the chat's 320px floor only leaves 934.
    expect(maxPanelWidth(VIEWPORT, CONTAINER)).toBe(CONTAINER - MOTHERSHIP_WIDTH.CHAT_MIN)
  })

  it('yields to the viewport share when the container is roomy', () => {
    expect(maxPanelWidth(VIEWPORT, 4000)).toBe(VIEWPORT * MOTHERSHIP_WIDTH.MAX_PERCENTAGE)
  })

  it('never returns less than the panel minimum', () => {
    // Minimum window size with the sidebar expanded cannot satisfy both.
    expect(maxPanelWidth(800, 543)).toBe(MOTHERSHIP_WIDTH.MIN)
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
