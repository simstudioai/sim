/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  CONNECTOR_SYNC_MAX_DURATION_SECONDS,
  CONNECTOR_SYNC_STALE_LOCK_TTL_MS,
  SYNC_LOCK_HEARTBEAT_INTERVAL_MS,
} from '@/lib/knowledge/connectors/sync-limits'

describe('connector sync limits', () => {
  /**
   * Reclaiming a stale lock frees it for another sync, so a TTL at or below the
   * run ceiling would start a second sync while the first is still writing. This
   * guards the invariant against a future hard-coded TTL, not the derivation.
   */
  it('keeps at least a 2x margin between the run ceiling and the reclaim', () => {
    expect(CONNECTOR_SYNC_STALE_LOCK_TTL_MS).toBeGreaterThanOrEqual(
      CONNECTOR_SYNC_MAX_DURATION_SECONDS * 2 * 1000
    )
  })

  /** A large library exhausted the previous 1800s budget partway through listing. */
  it('allows a run longer than the half hour that timed out in production', () => {
    expect(CONNECTOR_SYNC_MAX_DURATION_SECONDS).toBeGreaterThan(1800)
  })

  /**
   * A live run must beat several times over before the reclaim cutoff, or
   * ordinary jitter — a slow batch, a long upload — reclaims a working sync and
   * counts it as a failure it can never clear.
   */
  it('leaves room for several heartbeats inside the reclaim window', () => {
    expect(SYNC_LOCK_HEARTBEAT_INTERVAL_MS * 4).toBeLessThan(CONNECTOR_SYNC_STALE_LOCK_TTL_MS)
  })
})
