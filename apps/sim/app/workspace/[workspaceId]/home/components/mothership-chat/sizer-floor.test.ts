/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { nextSizerFloor } from '@/app/workspace/[workspaceId]/home/components/mothership-chat/sizer-floor'

/** Matches the transcript scroller's `pt-4 pb-2`. */
const PADDING = { paddingTop: 16, paddingBottom: 8 }
/** A viewport scrolled to the bottom of 2000px of content: extent resolves to 2000. */
const PINNED = { scrollTop: 1424, clientHeight: 600, ...PADDING }

describe('nextSizerFloor', () => {
  it('follows the scrolled-to extent while it stays under the high-water mark', () => {
    const { floor } = nextSizerFloor({
      ...PINNED,
      previousHighWater: 5000,
      appliedFloor: 0,
      contentHeight: 5000,
    })
    expect(floor).toBe(2000)
  })

  it('floors fractional scroll offsets down so the sizer cannot round above the extent', () => {
    const { floor } = nextSizerFloor({
      scrollTop: 100.7,
      clientHeight: 600,
      ...PADDING,
      previousHighWater: 5000,
      appliedFloor: 0,
      contentHeight: 5000,
    })
    expect(floor).toBe(676)
  })

  it('never returns a negative floor for a container smaller than its padding', () => {
    const { floor } = nextSizerFloor({
      scrollTop: 0,
      clientHeight: 8,
      ...PADDING,
      previousHighWater: 500,
      appliedFloor: 0,
      contentHeight: 500,
    })
    expect(floor).toBe(0)
  })

  it('never exceeds the content height when the transcript is shorter than the viewport', () => {
    const { floor } = nextSizerFloor({
      scrollTop: 0,
      clientHeight: 600,
      ...PADDING,
      previousHighWater: 0,
      appliedFloor: 0,
      contentHeight: 180,
    })
    expect(floor).toBe(180)
  })

  it('holds the high-water mark when content re-measures smaller mid-turn', () => {
    const { floor, highWater } = nextSizerFloor({
      ...PINNED,
      previousHighWater: 2000,
      appliedFloor: 2000,
      contentHeight: 1940,
    })
    expect(highWater).toBe(2000)
    expect(floor).toBe(2000)
  })

  it('carries undrained debt across a turn boundary that interrupts the drain', () => {
    const { floor, highWater } = nextSizerFloor({
      ...PINNED,
      previousHighWater: 0,
      appliedFloor: 1985,
      contentHeight: 1940,
    })
    expect(highWater).toBe(1985)
    expect(floor).toBe(1985)
  })

  it('raises the high-water mark as content grows', () => {
    const { highWater } = nextSizerFloor({
      ...PINNED,
      previousHighWater: 1200,
      appliedFloor: 1200,
      contentHeight: 1600,
    })
    expect(highWater).toBe(1600)
  })
})
