/**
 * @vitest-environment node
 */
import { account } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { sqlCalls } = vi.hoisted(() => ({
  sqlCalls: [] as Array<{ strings: readonly string[]; values: unknown[] }>,
}))

vi.mock('drizzle-orm', () => ({
  sql: (strings: readonly string[], ...values: unknown[]) => {
    const node = { strings, values }
    sqlCalls.push(node)
    return node
  },
  and: vi.fn(),
  eq: vi.fn((field: unknown, value: unknown) => ({ field, value })),
  isNull: vi.fn(),
  ne: vi.fn(),
  or: vi.fn(),
}))
vi.mock('@/app/api/auth/oauth/utils', () => ({
  getOAuthToken: vi.fn(),
  refreshAccessTokenIfNeeded: vi.fn(),
  resolveOAuthAccountId: vi.fn(),
}))
vi.mock('@/triggers/constants', () => ({ MAX_CONSECUTIVE_FAILURES: 5 }))

import type { WebhookRecord } from '@/lib/webhooks/polling/types'
import { resolveOAuthCredential, updateWebhookProviderConfig } from '@/lib/webhooks/polling/utils'
import {
  getOAuthToken,
  refreshAccessTokenIfNeeded,
  resolveOAuthAccountId,
} from '@/app/api/auth/oauth/utils'

afterAll(resetDbChainMock)

const logger = { error: vi.fn() } as never

function allInterpolatedValues(): unknown[] {
  return sqlCalls.flatMap((c) => c.values)
}

function allSqlText(): string {
  return sqlCalls.map((c) => c.strings.join('')).join(' ')
}

describe('updateWebhookProviderConfig (atomic jsonb merge)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    sqlCalls.length = 0
  })

  it('merges defined keys (null preserved) and removes undefined keys', async () => {
    await updateWebhookProviderConfig(
      'wh-1',
      { historyId: 'h1', cleared: undefined, nulled: null },
      logger
    )

    expect(dbChainMockFns.update).toHaveBeenCalledTimes(1)
    expect(allInterpolatedValues()).toContain(JSON.stringify({ historyId: 'h1', nulled: null }))
    expect(allInterpolatedValues()).toContainEqual(['cleared'])
  })

  it('uses merge only (no key-removal expression) when nothing is undefined', async () => {
    await updateWebhookProviderConfig('wh-1', { historyId: 'h1' }, logger)

    expect(allInterpolatedValues()).toContain(JSON.stringify({ historyId: 'h1' }))
    expect(allInterpolatedValues().some((v) => Array.isArray(v))).toBe(false)
  })

  it('casts the json column to jsonb for the merge and back to json for storage', async () => {
    await updateWebhookProviderConfig('wh-1', { historyId: 'h1', cleared: undefined }, logger)

    const sqlText = allSqlText()
    // Column (interpolated as a value) is cast to jsonb: `COALESCE(<col>::jsonb, ...)`
    expect(sqlText).toContain('COALESCE(::jsonb')
    // Merge runs in jsonb space, result cast back to the json column: `(<expr>)::json`
    expect(sqlText).toContain(')::json')
  })
})

describe('resolveOAuthCredential (single-credential polling)', () => {
  const makeWebhook = (providerConfig: Record<string, unknown>): WebhookRecord =>
    ({ id: 'wh-1', providerConfig }) as unknown as WebhookRecord

  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('resolves via credentialId: account lookup then token refresh', async () => {
    vi.mocked(resolveOAuthAccountId).mockResolvedValue({
      accountId: 'acc-1',
    } as Awaited<ReturnType<typeof resolveOAuthAccountId>>)
    queueTableRows(account, [{ userId: 'owner-1' }])
    vi.mocked(refreshAccessTokenIfNeeded).mockResolvedValue('tok-abc')

    const token = await resolveOAuthCredential(
      makeWebhook({ credentialId: 'cred-1' }),
      'google-email',
      'req-1'
    )

    expect(token).toBe('tok-abc')
    expect(resolveOAuthAccountId).toHaveBeenCalledWith('cred-1')
    expect(refreshAccessTokenIfNeeded).toHaveBeenCalledWith('acc-1', 'owner-1', 'req-1')
    expect(getOAuthToken).not.toHaveBeenCalled()
  })

  it('throws when the credential cannot be resolved to an OAuth account', async () => {
    vi.mocked(resolveOAuthAccountId).mockResolvedValue(null)

    await expect(
      resolveOAuthCredential(makeWebhook({ credentialId: 'cred-gone' }), 'google-email', 'req-1')
    ).rejects.toThrow('Failed to resolve OAuth account for credential cred-gone')
  })

  it('throws when the resolved account row does not exist', async () => {
    vi.mocked(resolveOAuthAccountId).mockResolvedValue({
      accountId: 'acc-missing',
    } as Awaited<ReturnType<typeof resolveOAuthAccountId>>)

    await expect(
      resolveOAuthCredential(makeWebhook({ credentialId: 'cred-1' }), 'google-email', 'req-1')
    ).rejects.toThrow('Credential cred-1 not found for webhook wh-1')
  })

  it('falls back to the legacy userId path via getOAuthToken', async () => {
    vi.mocked(getOAuthToken).mockResolvedValue('tok-legacy')

    const token = await resolveOAuthCredential(
      makeWebhook({ userId: 'user-1' }),
      'outlook',
      'req-1'
    )

    expect(token).toBe('tok-legacy')
    expect(getOAuthToken).toHaveBeenCalledWith('user-1', 'outlook')
    expect(resolveOAuthAccountId).not.toHaveBeenCalled()
  })

  it('throws when neither credentialId nor userId is present', async () => {
    await expect(resolveOAuthCredential(makeWebhook({}), 'gmail', 'req-1')).rejects.toThrow(
      'Missing credential info for webhook wh-1'
    )
  })

  it('throws when the legacy userId path yields no token', async () => {
    vi.mocked(getOAuthToken).mockResolvedValue(null)

    await expect(
      resolveOAuthCredential(makeWebhook({ userId: 'user-1' }), 'outlook', 'req-1')
    ).rejects.toThrow('Failed to get outlook access token for webhook wh-1')
  })
})
