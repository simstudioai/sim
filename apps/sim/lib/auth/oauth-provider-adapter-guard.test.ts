/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  delete: vi.fn(),
  insert: vi.fn(),
}))

vi.mock('@sim/db', () => ({ db: { delete: mocks.delete, insert: mocks.insert } }))

import {
  guardOAuthProviderWrites,
  withOAuthProviderIssuanceCompensation,
} from '@/lib/auth/oauth-provider-adapter-guard'

function adapter() {
  return {
    create: vi.fn(async () => ({ id: 'delegated' })),
  } as Parameters<typeof guardOAuthProviderWrites>[0]
}

function consentData() {
  return {
    clientId: 'sim-cli',
    userId: null,
    referenceId: null,
    scopes: ['api:read'],
    createdAt: new Date('2026-09-04T00:00:00Z'),
    updatedAt: new Date('2026-09-04T00:00:00Z'),
  }
}

function mockUpsert(rows: Record<string, unknown>[]) {
  const returning = vi.fn(async () => rows)
  const onConflictDoUpdate = vi.fn(() => ({ returning }))
  const values = vi.fn(() => ({ onConflictDoUpdate }))
  mocks.insert.mockReturnValue({ values })
  return { values, onConflictDoUpdate }
}

describe('guardOAuthProviderWrites', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.delete.mockReturnValue({ where: vi.fn(async () => undefined) })
  })

  it('atomically upserts consent with a generated id and the nullable natural key', async () => {
    const persisted = { id: 'persisted', ...consentData() }
    const chain = mockUpsert([persisted])
    const guarded = guardOAuthProviderWrites(adapter())

    await expect(guarded.create({ model: 'oauthConsent', data: consentData() })).resolves.toEqual(
      persisted
    )

    expect(chain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.any(String),
        clientId: 'sim-cli',
        userId: null,
        referenceId: null,
      })
    )
    expect(chain.onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        target: ['oauthConsent.userId', 'oauthConsent.clientId', 'oauthConsent.referenceId'],
        set: { scopes: ['api:read'], updatedAt: consentData().updatedAt },
      })
    )
  })

  it('preserves requested projection and refuses an empty RETURNING result', async () => {
    mockUpsert([{ id: 'persisted', ...consentData() }])
    const guarded = guardOAuthProviderWrites(adapter())
    await expect(
      guarded.create({ model: 'oauthConsent', data: consentData(), select: ['id', 'scopes'] })
    ).resolves.toEqual({ id: 'persisted', scopes: ['api:read'] })

    mockUpsert([])
    await expect(guarded.create({ model: 'oauthConsent', data: consentData() })).rejects.toThrow(
      'upsert returned no row'
    )
  })

  it('passes every non-consent model through unchanged', async () => {
    const base = adapter()
    const guarded = guardOAuthProviderWrites(base)
    await expect(guarded.create({ model: 'user', data: { name: 'Ada' } })).resolves.toEqual({
      id: 'delegated',
    })
    expect(base.create).toHaveBeenCalledOnce()
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('deletes a refresh family when delegated token issuance fails', async () => {
    const base = adapter()
    const guarded = guardOAuthProviderWrites(base)

    const response = await withOAuthProviderIssuanceCompensation(async () => {
      await guarded.create({ model: 'oauthRefreshToken', data: { token: 'hashed' } })
      return new Response('failed', { status: 500 })
    })

    expect(response.status).toBe(500)
    expect(mocks.delete).toHaveBeenCalledOnce()
  })

  it('retains a refresh family after successful delegated token issuance', async () => {
    const guarded = guardOAuthProviderWrites(adapter())

    await withOAuthProviderIssuanceCompensation(async () => {
      await guarded.create({ model: 'oauthRefreshToken', data: { token: 'hashed' } })
      return new Response(null, { status: 200 })
    })

    expect(mocks.delete).not.toHaveBeenCalled()
  })
})
