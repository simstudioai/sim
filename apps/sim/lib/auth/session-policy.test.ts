/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  clampSessionExpiry,
  MIN_IDLE_TIMEOUT_HOURS,
  type ResolvedSessionPolicy,
} from '@/lib/auth/session-policy'

const HOUR_MS = 60 * 60 * 1000

function policy(overrides: Partial<ResolvedSessionPolicy> = {}): ResolvedSessionPolicy {
  return { maxSessionHours: null, idleTimeoutHours: null, version: 1, ...overrides }
}

describe('clampSessionExpiry', () => {
  const createdAt = new Date('2026-07-22T00:00:00Z')
  const now = new Date('2026-07-22T12:00:00Z')
  /** Better Auth's sliding refresh proposes now + 30 days. */
  const proposed = new Date(now.getTime() + 30 * 24 * HOUR_MS)

  it('returns the proposed date unchanged when no policy fields are set', () => {
    expect(clampSessionExpiry(policy(), createdAt, proposed, now)).toBe(proposed)
  })

  it('caps absolute lifetime at createdAt + maxSessionHours', () => {
    const result = clampSessionExpiry(policy({ maxSessionHours: 24 }), createdAt, proposed, now)
    expect(result.getTime()).toBe(createdAt.getTime() + 24 * HOUR_MS)
  })

  it('re-clamps a sliding refresh that would stretch the session back out', () => {
    // 12h into a 24h-max session, a refresh proposing +30d must still end at
    // createdAt + 24h — this is the regression the update hook exists for.
    const midSession = new Date(createdAt.getTime() + 12 * HOUR_MS)
    const refreshProposal = new Date(midSession.getTime() + 30 * 24 * HOUR_MS)
    const result = clampSessionExpiry(
      policy({ maxSessionHours: 24 }),
      createdAt,
      refreshProposal,
      midSession
    )
    expect(result.getTime()).toBe(createdAt.getTime() + 24 * HOUR_MS)
  })

  it('caps idle expiry at now + idleTimeoutHours', () => {
    const result = clampSessionExpiry(policy({ idleTimeoutHours: 48 }), createdAt, proposed, now)
    expect(result.getTime()).toBe(now.getTime() + 48 * HOUR_MS)
  })

  it('floors idleTimeoutHours at the cookie-cache window', () => {
    const result = clampSessionExpiry(policy({ idleTimeoutHours: 1 }), createdAt, proposed, now)
    expect(result.getTime()).toBe(now.getTime() + MIN_IDLE_TIMEOUT_HOURS * HOUR_MS)
  })

  it('applies the stricter of max lifetime and idle timeout', () => {
    const result = clampSessionExpiry(
      policy({ maxSessionHours: 8760, idleTimeoutHours: 48 }),
      createdAt,
      proposed,
      now
    )
    expect(result.getTime()).toBe(now.getTime() + 48 * HOUR_MS)

    const nearEnd = new Date(createdAt.getTime() + 71 * HOUR_MS)
    const endOfLife = clampSessionExpiry(
      policy({ maxSessionHours: 72, idleTimeoutHours: 48 }),
      createdAt,
      new Date(nearEnd.getTime() + 30 * 24 * HOUR_MS),
      nearEnd
    )
    expect(endOfLife.getTime()).toBe(createdAt.getTime() + 72 * HOUR_MS)
  })

  it('never extends a proposal already shorter than the policy', () => {
    const shortProposal = new Date(now.getTime() + 1 * HOUR_MS)
    const result = clampSessionExpiry(
      policy({ maxSessionHours: 720, idleTimeoutHours: 720 }),
      createdAt,
      shortProposal,
      now
    )
    expect(result).toBe(shortProposal)
  })
})
