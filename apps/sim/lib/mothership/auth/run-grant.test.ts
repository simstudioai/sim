import { resetEnvMock, setEnv } from '@sim/testing/mocks/env.mock'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateInternalToken } from '@/lib/auth/internal'
import {
  acceptsRunGrant,
  checkRunGrant,
  issueRunGrant,
  rememberRunGrant,
  renewedRunGrant,
  runGrantHeaders,
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

  it('admits a grant for a turn with no chat only on calls that name no chat', async () => {
    const chatless = issueRunGrant({ ...turn, chatId: undefined })
    expect(await checkRunGrant(chatless, claimed)).toEqual({ ok: false, reason: 'mismatch' })
    const { chatId: _chatId, ...noChat } = claimed
    expect(await checkRunGrant(chatless, noChat)).toMatchObject({ ok: true })
  })

  it('issues no grants and serves grant-less calls where Sim runs without an auth secret', async () => {
    const grant = issueRunGrant(turn)
    setEnv({ BETTER_AUTH_SECRET: undefined })
    expect(runGrantHeaders({ userId: 'actor', chatId: 'chat-1', workspaceId: 'ws-1' })).toEqual({})
    const check = await checkRunGrant(grant, claimed)
    expect(check).toEqual({ ok: false, reason: 'missing' })
    expect(acceptsRunGrant(check)).toBe(true)
  })

  it('reads the enforcement switch as the string the environment holds', async () => {
    const missing = await checkRunGrant(undefined, claimed)
    for (const [value, accepted] of [
      ['false', true],
      ['0', true],
      ['true', false],
      ['1', false],
    ] as const) {
      setEnv({ MOTHERSHIP_REQUIRE_RUN_GRANT: value })
      expect([value, acceptsRunGrant(missing)]).toEqual([value, accepted])
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
