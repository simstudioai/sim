/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { savedTokenExpiryLabel } from '@/lib/credentials/expiry-label'

const NOW = Date.parse('2026-11-11T12:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000

describe('saved token expiry caption', () => {
  it.each([
    ['at the moment it expires', 0, 'expired'],
    ['after it expired', -DAY_MS, 'expired'],
    ['with a minute left', 60_000, 'expires in 1 day'],
    ['with exactly a day left', DAY_MS, 'expires in 1 day'],
    ['with just over a day left', DAY_MS + 1, 'expires in 2 days'],
    ['with a month left', 30 * DAY_MS, 'expires in 30 days'],
  ])('reads %s', (_, remainingMs, label) => {
    expect(savedTokenExpiryLabel(new Date(NOW + remainingMs), NOW)).toBe(label)
  })
})
