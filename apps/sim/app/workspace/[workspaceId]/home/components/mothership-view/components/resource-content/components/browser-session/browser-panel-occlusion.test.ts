import { describe, expect, it, vi } from 'vitest'
import {
  isPanelObscuredByOverlay,
  overlayRectsIntersect,
} from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/browser-session/browser-panel-occlusion'

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    bottom: top + height,
    height,
    left,
    right: left + width,
    top,
    width,
  } as DOMRect
}

function overlay(bounds: DOMRect): HTMLElement {
  return {
    getBoundingClientRect: vi.fn(() => bounds),
  } as unknown as HTMLElement
}

describe('browser panel occlusion', () => {
  it('detects intersecting rectangles but not touching or empty rectangles', () => {
    expect(overlayRectsIntersect(rect(0, 0, 100, 100), rect(50, 50, 100, 100))).toBe(true)
    expect(overlayRectsIntersect(rect(0, 0, 100, 100), rect(100, 0, 100, 100))).toBe(false)
    expect(overlayRectsIntersect(rect(0, 0, 0, 100), rect(0, 0, 100, 100))).toBe(false)
  })

  it('detects any tagged overlay that intersects the browser host', () => {
    const host = {
      contains: vi.fn(() => false),
    } as unknown as HTMLElement

    expect(
      isPanelObscuredByOverlay(host, rect(100, 100, 500, 400), [
        overlay(rect(20, 20, 40, 40)),
        overlay(rect(300, 80, 200, 80)),
      ])
    ).toBe(true)
  })

  it('ignores overlays outside the host and overlays rendered inside it', () => {
    const nestedOverlay = overlay(rect(120, 120, 100, 40))
    const host = {
      contains: vi.fn((element) => element === nestedOverlay),
    } as unknown as HTMLElement

    expect(
      isPanelObscuredByOverlay(host, rect(100, 100, 500, 400), [
        overlay(rect(20, 20, 40, 40)),
        nestedOverlay,
      ])
    ).toBe(false)
  })
})
