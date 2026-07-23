/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => {
  const verificationTable = {
    id: 'verification.id',
    identifier: 'verification.identifier',
    expiresAt: 'verification.expiresAt',
  }
  const ssoProviderTable = {
    id: 'ssoProvider.id',
    providerId: 'ssoProvider.providerId',
  }
  return {
    deleteCalls: 0,
    intents: [] as Array<{ id: string }>,
    lockDepth: 0,
    providerExists: true,
    verificationTable,
    ssoProviderTable,
    withLock: vi.fn(),
  }
})

function rowsBuilder(rows: Array<{ id: string }>) {
  const builder = Promise.resolve(rows) as Promise<Array<{ id: string }>> & {
    limit: () => Promise<Array<{ id: string }>>
  }
  builder.limit = () => Promise.resolve(rows.slice(0, 1))
  return builder
}

vi.mock('@sim/db', () => ({
  account: {},
  member: {},
  SSO_CALLBACK_INTENT_PREFIX: 'sso-callback-intent:',
  ssoProvider: state.ssoProviderTable,
  verification: state.verificationTable,
  withSSOProviderMutationLock: state.withLock,
  db: {
    delete: () => ({
      where: async () => {
        state.deleteCalls += 1
        if (state.deleteCalls > 1) state.intents = []
      },
    }),
    insert: () => ({
      values: async (value: { id: string }) => {
        state.intents.push({ id: value.id })
      },
    }),
    select: () => ({
      from: (table: unknown) => ({
        where: () =>
          rowsBuilder(
            table === state.ssoProviderTable
              ? state.providerExists
                ? [{ id: 'provider-row' }]
                : []
              : state.intents
          ),
      }),
    }),
  },
}))

vi.mock('@sim/utils/id', () => ({ generateId: () => 'intent-1' }))
vi.mock('@sim/logger', () => ({
  createLogger: () => ({ error: vi.fn() }),
}))
vi.mock('@/lib/billing', () => ({ isOrganizationOnEnterprisePlan: vi.fn() }))
vi.mock('@/lib/core/security/input-validation.server', () => ({
  secureFetchWithPinnedIP: vi.fn(),
  validateUrlWithDNS: vi.fn(),
}))
vi.mock('@/lib/core/utils/urls', () => ({ getBaseUrl: () => 'https://app.example.com' }))

import { assertNoActiveSSOCallbacks, withSSOCallbackIntent } from '@/lib/auth/sso/callback-intent'

describe('SSO callback intents', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.deleteCalls = 0
    state.intents = []
    state.lockDepth = 0
    state.providerExists = true
    state.withLock.mockImplementation(async (callback: () => Promise<unknown>) => {
      state.lockDepth += 1
      try {
        return await callback()
      } finally {
        state.lockDepth -= 1
      }
    })
  })

  it('releases the mutation lock before callback work and removes the intent afterward', async () => {
    await withSSOCallbackIntent('acme', async () => {
      expect(state.lockDepth).toBe(0)
      expect(state.intents).toEqual([{ id: 'intent-1' }])
    })

    expect(state.intents).toEqual([])
    expect(state.withLock).toHaveBeenCalledOnce()
  })

  it('does not register an intent for an unknown provider', async () => {
    state.providerExists = false

    await withSSOCallbackIntent('missing', async () => {
      expect(state.intents).toEqual([])
    })
  })

  it('blocks identity mutations while an unexpired callback intent exists', async () => {
    state.intents = [{ id: 'active-intent' }]

    await expect(assertNoActiveSSOCallbacks('acme')).rejects.toMatchObject({
      code: 'SSO_CALLBACK_IN_PROGRESS',
      status: 409,
    })
  })
})
