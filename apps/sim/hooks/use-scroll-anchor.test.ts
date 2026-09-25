/**
 * Tests for the pure functions extracted from `useScrollAnchor`:
 * `computeSpacerShortage` and `shouldReengage`. The hook's DOM-interaction
 * behaviour (event listeners, MutationObserver, and the forced-reflow /
 * scroll-event race condition fix) requires a real browser layout engine
 * and is covered by manual QA.
 */
import { describe, expect, it } from 'vitest'
import { computeSpacerShortage, shouldReengage } from '@/hooks/use-scroll-anchor'

describe('computeSpacerShortage', () => {
  it('subtracts existing spacer height before recomputing shortage', () => {
    // spacer was 900 from last update; content grew to 1000 natural height
    // scrollHeight = 1000 + 900 = 1900; needed = 500 + 600 = 1100
    // naturalScrollHeight = 1900 - 900 = 1000; shortage = 1100 - 1000 = 100
    expect(computeSpacerShortage(500, 600, 1900, 900)).toBe(100)
  })

  it('never returns a negative value', () => {
    expect(computeSpacerShortage(0, 600, 10000, 0)).toBe(0)
    expect(computeSpacerShortage(0, 600, 0, 0)).toBe(600)
  })
})

describe('shouldReengage', () => {
  it('returns false when the spacer is active, even at distanceFromBottom = 0', () => {
    // The spacer inflates scrollHeight to exactly targetScrollTop + clientHeight,
    // so programmatic scroll restoration always produces distanceFromBottom = 0.
    // Without this guard, onScroll would falsely re-engage auto-follow, clear the
    // spacer on the next content update, and jump the user to the top.
    expect(shouldReengage(0, 1000)).toBe(false)
  })

  it('returns true when the user genuinely reaches the document bottom (no spacer)', () => {
    expect(shouldReengage(0, 0)).toBe(true)
  })

  it('returns false when exactly at threshold + 1', () => {
    expect(shouldReengage(31, 0)).toBe(false)
  })
})
