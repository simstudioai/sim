/**
 * @vitest-environment node
 *
 * Tests for the pure functions extracted from `useScrollAnchor`:
 * `computeSpacerShortage` and `shouldReengage`. The hook's DOM-interaction
 * behaviour (event listeners, MutationObserver, and the forced-reflow /
 * scroll-event race condition fix) requires a real browser layout engine
 * and is covered by manual QA.
 */
import { describe, expect, it } from 'vitest'
import { computeSpacerShortage, shouldReengage } from '@/hooks/use-scroll-anchor'

describe('computeSpacerShortage', () => {
  it('returns 0 when content is exactly tall enough', () => {
    // user at 500, viewport 600 → needs 1100; content is exactly 1100
    expect(computeSpacerShortage(500, 600, 1100, 0)).toBe(0)
  })

  it('returns 0 when content is taller than needed', () => {
    // user at 500, viewport 600 → needs 1100; content is 2000
    expect(computeSpacerShortage(500, 600, 2000, 0)).toBe(0)
  })

  it('returns 0 when user is at the very top (targetScrollTop = 0) and content fills viewport', () => {
    // no scroll required; all content visible
    expect(computeSpacerShortage(0, 600, 600, 0)).toBe(0)
  })

  it('returns 0 when user is at the very top and content exceeds viewport', () => {
    expect(computeSpacerShortage(0, 600, 1000, 0)).toBe(0)
  })

  it('returns positive shortage when content shrank to almost nothing', () => {
    // user at 500, viewport 600 → needs 1100; content shrank to 100
    expect(computeSpacerShortage(500, 600, 100, 0)).toBe(1000)
  })

  it('returns positive shortage when content is shorter than viewport', () => {
    // user at 200, viewport 600 → needs 800; content is 300
    expect(computeSpacerShortage(200, 600, 300, 0)).toBe(500)
  })

  it('returns the exact gap when content is one pixel short', () => {
    expect(computeSpacerShortage(500, 600, 1099, 0)).toBe(1)
  })

  it('subtracts existing spacer height before recomputing shortage', () => {
    // spacer was 900 from last update; content grew to 1000 natural height
    // scrollHeight = 1000 + 900 = 1900; needed = 500 + 600 = 1100
    // naturalScrollHeight = 1900 - 900 = 1000; shortage = 1100 - 1000 = 100
    expect(computeSpacerShortage(500, 600, 1900, 900)).toBe(100)
  })

  it('returns 0 and spacer should be cleared when content has grown past needed', () => {
    // spacer was 500; content has now grown enough that no spacer is needed
    // naturalScrollHeight = 2000 - 500 = 1500 > 1100 needed
    expect(computeSpacerShortage(500, 600, 2000, 500)).toBe(0)
  })

  it('returns required spacer height even when scroll height already equals needed', () => {
    // spacer was 900; natural content is 200; scrollHeight = 1100; needed = 1100
    // naturalScrollHeight = 1100 - 900 = 200; shortage = 1100 - 200 = 900
    // The function returns the new target minHeight (900), not the change delta (0)
    expect(computeSpacerShortage(500, 600, 1100, 900)).toBe(900)
  })

  it('correctly recomputes when spacer is larger than needed', () => {
    // spacer was over-inflated at 1200; content grew to 800 naturally
    // scrollHeight = 2000; naturalScrollHeight = 2000 - 1200 = 800; needed = 1100
    // shortage = 1100 - 800 = 300 (spacer should shrink from 1200 to 300)
    expect(computeSpacerShortage(500, 600, 2000, 1200)).toBe(300)
  })

  it('handles large scroll positions correctly', () => {
    // user at 5000, viewport 600 → needs 5600; content shrank to 200
    expect(computeSpacerShortage(5000, 600, 200, 0)).toBe(5400)
  })

  it('handles user scrolled to the absolute bottom', () => {
    // user at bottom: scrollTop = scrollHeight - clientHeight = 2000 - 600 = 1400
    // content shrinks to 100; needed = 1400 + 600 = 2000; shortage = 2000 - 100 = 1900
    expect(computeSpacerShortage(1400, 600, 100, 0)).toBe(1900)
  })

  it('handles zero-height content', () => {
    // first streaming chunk is empty; user was at 500
    expect(computeSpacerShortage(500, 600, 0, 0)).toBe(1100)
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

  it('returns false when spacer is active and distance is within threshold', () => {
    expect(shouldReengage(15, 500)).toBe(false)
  })

  it('returns false when spacer is even slightly active', () => {
    expect(shouldReengage(0, 1)).toBe(false)
  })

  it('returns true when the user genuinely reaches the document bottom (no spacer)', () => {
    expect(shouldReengage(0, 0)).toBe(true)
  })

  it('returns true when within threshold and spacer is cleared', () => {
    expect(shouldReengage(30, 0)).toBe(true)
  })

  it('returns true when one pixel within threshold', () => {
    expect(shouldReengage(29, 0)).toBe(true)
  })

  it('returns false when beyond threshold regardless of spacer', () => {
    expect(shouldReengage(31, 0)).toBe(false)
    expect(shouldReengage(31, 1000)).toBe(false)
  })

  it('returns false when exactly at threshold + 1', () => {
    expect(shouldReengage(31, 0)).toBe(false)
  })
})
