/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockEncryptSecret, mockDecryptSecret } = vi.hoisted(() => ({
  mockEncryptSecret: vi.fn(),
  mockDecryptSecret: vi.fn(),
}))

/** The shared env mock's ENCRYPTION_KEY is not 64 hex characters, so real crypto would throw. */
vi.mock('@/lib/core/security/encryption', () => ({
  encryptSecret: mockEncryptSecret,
  decryptSecret: mockDecryptSecret,
}))

import { encryptSsoProviderSecrets } from '@/lib/auth/sso-provider-secret-adapter'

const IV = 'a'.repeat(32)
const TAG = 'b'.repeat(32)
/** What `encryptSecret` returns; `provider-secrets` adds the prefix around it. */
const raw = (secret: string) => `${IV}:${Buffer.from(secret).toString('hex')}:${TAG}`
const sealed = (secret: string) => `sim.sso.v1:${raw(secret)}`

const PLAIN_OIDC = JSON.stringify({ clientId: 'client', clientSecret: 'super-secret' })
const SEALED_OIDC = JSON.stringify({ clientId: 'client', clientSecret: sealed('super-secret') })

function createBaseAdapter() {
  return {
    create: vi.fn(async (input: { data: unknown }) => input.data),
    update: vi.fn(async (input: { update: unknown }) => input.update),
    findOne: vi.fn(async () => ({ id: 'p1', oidcConfig: SEALED_OIDC })),
    findMany: vi.fn(async () => [{ id: 'p1', oidcConfig: SEALED_OIDC }]),
    consumeOne: vi.fn(async () => ({ id: 'p1', oidcConfig: SEALED_OIDC })),
    incrementOne: vi.fn(async () => ({ id: 'p1', oidcConfig: SEALED_OIDC })),
    transaction: vi.fn(async (callback: (trx: unknown) => Promise<unknown>) =>
      callback(createBaseAdapter())
    ),
  }
}

// double-cast-allowed: test double implements only the adapter subset the decorator touches
const asAdapter = (adapter: ReturnType<typeof createBaseAdapter>) =>
  encryptSsoProviderSecrets(adapter as unknown as Parameters<typeof encryptSsoProviderSecrets>[0])

describe('encryptSsoProviderSecrets', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEncryptSecret.mockImplementation(async (secret: string) => ({ encrypted: raw(secret) }))
    mockDecryptSecret.mockImplementation(async (value: string) => ({
      decrypted: Buffer.from(value.split(':')[1], 'hex').toString('utf8'),
    }))
  })

  it('encrypts the secret on create and returns the row decrypted', async () => {
    const adapter = createBaseAdapter()

    const created = await asAdapter(adapter).create({
      model: 'ssoProvider',
      data: { providerId: 'acme-okta', oidcConfig: PLAIN_OIDC },
    } as never)

    const written = adapter.create.mock.calls[0][0] as { data: { oidcConfig: string } }
    expect(JSON.parse(written.data.oidcConfig).clientSecret).toBe(sealed('super-secret'))
    expect(written.data.oidcConfig).not.toContain('super-secret')
    expect(JSON.parse((created as { oidcConfig: string }).oidcConfig).clientSecret).toBe(
      'super-secret'
    )
  })

  it('encrypts the secret on update and returns the updated row decrypted', async () => {
    const adapter = createBaseAdapter()

    const updated = await asAdapter(adapter).update({
      model: 'ssoProvider',
      where: [{ field: 'providerId', value: 'acme-okta' }],
      update: { oidcConfig: PLAIN_OIDC },
    } as never)

    const written = adapter.update.mock.calls[0][0] as { update: { oidcConfig: string } }
    expect(written.update.oidcConfig).not.toContain('super-secret')
    expect(JSON.parse((updated as { oidcConfig: string }).oidcConfig).clientSecret).toBe(
      'super-secret'
    )
  })

  it('encrypts SAML key material but not the certificate', async () => {
    const adapter = createBaseAdapter()

    await asAdapter(adapter).create({
      model: 'ssoProvider',
      data: { samlConfig: JSON.stringify({ cert: 'public-cert', privateKey: 'sp-key' }) },
    } as never)

    const written = adapter.create.mock.calls[0][0] as { data: { samlConfig: string } }
    const parsed = JSON.parse(written.data.samlConfig)
    expect(parsed.cert).toBe('public-cert')
    expect(parsed.privateKey).toBe(sealed('sp-key'))
  })

  it.each(['findOne', 'consumeOne', 'incrementOne'] as const)(
    'decrypts the row returned by %s',
    async (method) => {
      const adapter = createBaseAdapter()

      const row = await asAdapter(adapter)[method]({ model: 'ssoProvider', where: [] } as never)

      expect(JSON.parse((row as { oidcConfig: string }).oidcConfig).clientSecret).toBe(
        'super-secret'
      )
    }
  )

  it('decrypts every row returned by findMany', async () => {
    const adapter = createBaseAdapter()

    const rows = await asAdapter(adapter).findMany({ model: 'ssoProvider' } as never)

    expect(JSON.parse((rows as { oidcConfig: string }[])[0].oidcConfig).clientSecret).toBe(
      'super-secret'
    )
  })

  it('returns a value written before encryption existed unchanged', async () => {
    const adapter = createBaseAdapter()
    adapter.findOne.mockResolvedValue({ id: 'p1', oidcConfig: PLAIN_OIDC })

    const row = await asAdapter(adapter).findOne({ model: 'ssoProvider', where: [] } as never)

    expect((row as { oidcConfig: string }).oidcConfig).toBe(PLAIN_OIDC)
    expect(mockDecryptSecret).not.toHaveBeenCalled()
  })

  it.each([
    ['a row without the config columns', { id: 'p1' }],
    ['a null column', { id: 'p1', oidcConfig: null }],
    ['no row at all', null],
  ])('tolerates %s', async (_label, stored) => {
    const adapter = createBaseAdapter()
    adapter.findOne.mockResolvedValue(stored as never)

    await expect(
      asAdapter(adapter).findOne({ model: 'ssoProvider', where: [] } as never)
    ).resolves.toEqual(stored)
  })

  it('leaves writes and reads on other models untouched', async () => {
    const adapter = createBaseAdapter()
    const guarded = asAdapter(adapter)

    await guarded.create({ model: 'user', data: { oidcConfig: PLAIN_OIDC } } as never)
    await guarded.findOne({ model: 'user', where: [] } as never)

    const written = adapter.create.mock.calls[0][0] as { data: { oidcConfig: string } }
    expect(written.data.oidcConfig).toBe(PLAIN_OIDC)
    expect(mockEncryptSecret).not.toHaveBeenCalled()
    expect(mockDecryptSecret).not.toHaveBeenCalled()
  })

  it('applies the same encoding to writes inside a transaction', async () => {
    const inner = createBaseAdapter()
    const adapter = createBaseAdapter()
    adapter.transaction.mockImplementation(async (callback) => callback(inner))

    await asAdapter(adapter).transaction(async (trx) =>
      (trx as ReturnType<typeof encryptSsoProviderSecrets>).create({
        model: 'ssoProvider',
        data: { oidcConfig: PLAIN_OIDC },
      } as never)
    )

    const written = inner.create.mock.calls[0][0] as { data: { oidcConfig: string } }
    expect(written.data.oidcConfig).not.toContain('super-secret')
  })
})
