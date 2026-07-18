import { describe, expect, it } from 'vitest'
import {
  isPreviewSessionPastHardMax,
  PREVIEW_PIN_TTL_MS,
  PREVIEW_SESSION_HARD_MAX_MS,
  previewPinExpiresAtForSession,
} from '@/lib/apps/preview-ttl'

describe('preview session TTL', () => {
  it('uses the normal sliding TTL early in a session', () => {
    const startedAt = new Date('2026-01-01T00:00:00.000Z')
    const now = startedAt.getTime() + 60_000

    expect(previewPinExpiresAtForSession(startedAt, now).getTime()).toBe(now + PREVIEW_PIN_TTL_MS)
  })

  it('clamps heartbeat expiry to the 24-hour hard maximum', () => {
    const startedAt = new Date('2026-01-01T00:00:00.000Z')
    const now = startedAt.getTime() + PREVIEW_SESSION_HARD_MAX_MS - 60_000

    expect(previewPinExpiresAtForSession(startedAt, now).getTime()).toBe(
      startedAt.getTime() + PREVIEW_SESSION_HARD_MAX_MS
    )
    expect(
      isPreviewSessionPastHardMax(startedAt, startedAt.getTime() + PREVIEW_SESSION_HARD_MAX_MS + 1)
    ).toBe(true)
  })
})
