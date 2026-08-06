/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { isListingTruncated } from '@/connectors/utils'

/**
 * `capReached` means the budget is spent, not that anything was left behind.
 * Conflating the two suppresses deletion reconciliation on a complete listing, so a
 * source deletion could never propagate to the knowledge base.
 */
describe('isListingTruncated', () => {
  it('is not truncated when the source runs out exactly at the cap', () => {
    expect(
      isListingTruncated({ capReached: true, droppedFromPage: false, morePagesAvailable: false })
    ).toBe(false)
  })

  it('is truncated when this page had to drop items', () => {
    expect(
      isListingTruncated({ capReached: true, droppedFromPage: true, morePagesAvailable: false })
    ).toBe(true)
  })

  it('is truncated when the budget ran out with more pages left', () => {
    expect(
      isListingTruncated({ capReached: true, droppedFromPage: false, morePagesAvailable: true })
    ).toBe(true)
  })

  /** A full page with budget to spare is just pagination, not truncation. */
  it('is not truncated when more pages remain but the cap was not reached', () => {
    expect(
      isListingTruncated({ capReached: false, droppedFromPage: false, morePagesAvailable: true })
    ).toBe(false)
  })
})
