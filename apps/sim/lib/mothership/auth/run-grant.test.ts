import { resetEnvMock, setEnv } from '@sim/testing/mocks/env.mock'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateInternalToken } from '@/lib/auth/internal'
import {
  acceptsRunGrant,
  checkRunGrant,
  issueRunGrant,
  rememberRunGrant,
  renewedRunGrant,
} from '@/lib/mothership/auth/run-grant'

const HOUR_MS = 60 * 60 * 1000
const turn = { userId: 'actor', chatId: 'chat-1', workspaceId: 'ws-1', organizationId: null }
const claimed = { userId: 'actor', chatId: 'chat-1', workspaceId: 'ws-1' }

describe('run grants', () => {
  afterEach(() => {
    resetEnvMock()
    vi.useRealTimers()
  })

  it('admits a call naming exactly the identity its grant names, and no other', async () => {
    const grant = issueRunGrant(turn)
    expect(await checkRunGrant(grant, claimed)).toMatchObject({ ok: true, identity: turn })
    for (const other of [
      { ...claimed, userId: 'someone-else' },
      { ...claimed, chatId: 'chat-2' },
      { ...claimed, workspaceId: 'ws-2' },
      { userId: 'actor', chatId: 'chat-1', organizationId: 'org-1' },
    ]) {
      expect(await checkRunGrant(grant, other)).toEqual({ ok: false, reason: 'mismatch' })
    }
  })

  it('refuses a token the worker could mint itself with the secret it holds', async () => {
    const forged = await generateInternalToken('actor')
    const check = await checkRunGrant(forged, claimed)
    expect(check).toEqual({ ok: false, reason: 'invalid' })
    expect(acceptsRunGrant(check)).toBe(false)
  })

  it('serves a call with a missing or expired grant only until grants are required', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now())
    const grant = issueRunGrant(turn)
    vi.setSystemTime(Date.now() + 25 * HOUR_MS)
    const expired = await checkRunGrant(grant, claimed)
    const missing = await checkRunGrant(undefined, claimed)
    expect([expired, missing]).toEqual([
      { ok: false, reason: 'expired' },
      { ok: false, reason: 'missing' },
    ])
    expect([acceptsRunGrant(expired), acceptsRunGrant(missing)]).toEqual([true, true])
    setEnv({ MOTHERSHIP_REQUIRE_RUN_GRANT: true })
    expect([acceptsRunGrant(expired), acceptsRunGrant(missing)]).toEqual([false, false])
  })

  it('renews a verified grant once past half its life, for the same identity only', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const issuedAt = Date.now()
    vi.setSystemTime(issuedAt)
    const verified = {}
    rememberRunGrant(verified, await checkRunGrant(issueRunGrant(turn), claimed))
    vi.setSystemTime(issuedAt + 11 * HOUR_MS)
    expect(renewedRunGrant(verified)).toBeUndefined()
    vi.setSystemTime(issuedAt + 13 * HOUR_MS)
    const renewed = renewedRunGrant(verified)
    expect(await checkRunGrant(renewed, claimed)).toMatchObject({ ok: true, identity: turn })
    const unverified = {}
    rememberRunGrant(unverified, await checkRunGrant(undefined, claimed))
    expect(renewedRunGrant(unverified)).toBeUndefined()
  })
})
