/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockWhere, envRef } = vi.hoisted(() => ({
  mockWhere: vi.fn(),
  envRef: {
    BLOCKED_SIGNUP_DOMAINS: undefined as string | undefined,
    BLOCKED_EMAILS: undefined as string | undefined,
  },
}))

vi.mock('@sim/db', () => ({
  db: { select: vi.fn(() => ({ from: vi.fn(() => ({ where: mockWhere })) })) },
  user: { id: 'id', email: 'email', banned: 'banned', banExpires: 'banExpires' },
}))
vi.mock('drizzle-orm', () => ({ inArray: vi.fn(), sql: vi.fn() }))
vi.mock('@/lib/core/config/appconfig', () => ({ fetchAppConfigProfile: vi.fn() }))
vi.mock('@/lib/core/config/env', () => ({
  get env() {
    return envRef
  },
}))
vi.mock('@/lib/core/config/env-flags', () => ({ isAppConfigEnabled: false }))

import { getActivelyBannedUserIds, isBanActive, isEmailBlocked } from '@/lib/auth/ban'

describe('isBanActive', () => {
  it('returns true for a permanent ban', () => {
    expect(isBanActive({ banned: true, banExpires: null })).toBe(true)
  })

  it('returns false for an expired temporary ban', () => {
    expect(isBanActive({ banned: true, banExpires: new Date(Date.now() - 1000) })).toBe(false)
  })

  it('returns true for an unexpired temporary ban', () => {
    expect(isBanActive({ banned: true, banExpires: new Date(Date.now() + 60_000) })).toBe(true)
  })

  it('returns false when not banned', () => {
    expect(isBanActive({ banned: false, banExpires: null })).toBe(false)
    expect(isBanActive({ banned: null, banExpires: null })).toBe(false)
  })
})

describe('isEmailBlocked', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    envRef.BLOCKED_SIGNUP_DOMAINS = 'bad.com'
    envRef.BLOCKED_EMAILS = 'spam@evil.com'
    mockWhere.mockResolvedValue([])
  })

  it('returns true for blocked domains and subdomains without querying users', async () => {
    expect(await isEmailBlocked('a@bad.com')).toBe(true)
    expect(await isEmailBlocked('a@mail.bad.com')).toBe(true)
    expect(mockWhere).not.toHaveBeenCalled()
  })

  it('returns true for individually blocked emails without querying users', async () => {
    expect(await isEmailBlocked('spam@evil.com')).toBe(true)
    expect(mockWhere).not.toHaveBeenCalled()
  })

  it('returns true when the email belongs to an actively banned account', async () => {
    mockWhere.mockResolvedValue([{ banned: true, banExpires: null }])
    expect(await isEmailBlocked('a@good.com')).toBe(true)
  })

  it('returns false for clean accounts and missing emails', async () => {
    expect(await isEmailBlocked('a@good.com')).toBe(false)
    expect(await isEmailBlocked(null)).toBe(false)
    expect(await isEmailBlocked(undefined)).toBe(false)
  })
})

describe('getActivelyBannedUserIds', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    envRef.BLOCKED_SIGNUP_DOMAINS = undefined
    envRef.BLOCKED_EMAILS = undefined
    mockWhere.mockResolvedValue([])
  })

  it('short-circuits on empty input without querying', async () => {
    expect(await getActivelyBannedUserIds([])).toEqual([])
    expect(await getActivelyBannedUserIds([''])).toEqual([])
    expect(mockWhere).not.toHaveBeenCalled()
  })

  it('returns ids with an active db ban', async () => {
    mockWhere.mockResolvedValue([
      { id: 'u1', email: 'a@ok.com', banned: true, banExpires: null },
      { id: 'u2', email: 'b@ok.com', banned: false, banExpires: null },
    ])
    expect(await getActivelyBannedUserIds(['u1', 'u2'])).toEqual(['u1'])
  })

  it('treats an expired ban as lifted', async () => {
    mockWhere.mockResolvedValue([
      { id: 'u1', email: 'a@ok.com', banned: true, banExpires: new Date(Date.now() - 1000) },
    ])
    expect(await getActivelyBannedUserIds(['u1'])).toEqual([])
  })

  it('returns ids whose email is individually blocked', async () => {
    envRef.BLOCKED_EMAILS = 'spam@evil.com'
    mockWhere.mockResolvedValue([
      { id: 'u1', email: 'spam@evil.com', banned: false, banExpires: null },
      { id: 'u2', email: 'ok@evil.com', banned: false, banExpires: null },
    ])
    expect(await getActivelyBannedUserIds(['u1', 'u2'])).toEqual(['u1'])
  })

  it('returns ids whose email domain is in the blocked-domains list, including subdomains', async () => {
    envRef.BLOCKED_SIGNUP_DOMAINS = 'bad.com'
    mockWhere.mockResolvedValue([
      { id: 'u1', email: 'a@bad.com', banned: false, banExpires: null },
      { id: 'u2', email: 'b@mail.bad.com', banned: false, banExpires: null },
      { id: 'u3', email: 'c@good.com', banned: false, banExpires: null },
    ])
    expect(await getActivelyBannedUserIds(['u1', 'u2', 'u3'])).toEqual(['u1', 'u2'])
  })

  it('propagates db failures so callers fail closed', async () => {
    mockWhere.mockRejectedValue(new Error('db down'))
    await expect(getActivelyBannedUserIds(['u1'])).rejects.toThrow('db down')
  })
})
