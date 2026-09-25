import { describe, expect, it } from 'vitest'
import { v2LimitSchema } from '@/lib/api/contracts/v2/shared'

/**
 * `limit` is the one v2 query param whose value reaches SQL as a number rather
 * than a bound comparison, so a value that survives validation but is not a
 * whole number lands in `LIMIT`. `GET /api/v2/workflows` shipped without
 * `.int()` — copied from a sibling that had it — and `?limit=1.5` therefore
 * became `LIMIT 2.5`, a Postgres type error surfacing as 500. A caller-supplied
 * query value must never be able to produce a 500. The rejecting form is
 * enforced on every paged list by the sweep in `list-pagination.test.ts`.
 */
describe('v2 limit validation', () => {
  /**
   * `/files`, `/logs`, and `/tables` shipped truncating and clamping instead,
   * and published that leniency in their OpenAPI description, so they keep it.
   * Pinning it here is what makes the difference deliberate rather than another
   * copy that lost its `.int()`.
   */
  describe('the clamping variant kept for already-shipped lenient lists', () => {
    const clamped = v2LimitSchema({ max: 1000, fallback: 100, outOfRange: 'clamp' })

    it('truncates a fractional limit rather than rejecting it', () => {
      expect(clamped.parse('1.5')).toBe(1)
      expect(clamped.parse('7.9')).toBe(7)
    })

    it('clamps out-of-range values into the accepted band', () => {
      expect(clamped.parse('0')).toBe(1)
      expect(clamped.parse('-5')).toBe(1)
      expect(clamped.parse('99999')).toBe(1000)
    })
  })
})
