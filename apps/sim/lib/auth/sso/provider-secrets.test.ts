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

import { decryptProviderConfig, encryptProviderConfig } from '@/lib/auth/sso/provider-secrets'

const IV = 'a'.repeat(32)
const TAG = 'b'.repeat(32)
const envelope = (ciphertext: string) => `${IV}:${ciphertext}:${TAG}`

describe('provider secrets', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEncryptSecret.mockImplementation(async (secret: string) => ({
      encrypted: envelope(Buffer.from(secret).toString('hex')),
    }))
    mockDecryptSecret.mockImplementation(async (value: string) => ({
      decrypted: Buffer.from(value.split(':')[1], 'hex').toString('utf8'),
    }))
  })

  it('encrypts only the client secret and leaves the rest of the config readable', async () => {
    const stored = await encryptProviderConfig(
      JSON.stringify({ clientId: 'client', clientSecret: 'super-secret', pkce: true }),
      'oidcConfig'
    )

    const parsed = JSON.parse(stored as string)
    expect(parsed.clientSecret).toBe(envelope(Buffer.from('super-secret').toString('hex')))
    expect(parsed).toMatchObject({ clientId: 'client', pkce: true })
    expect(stored).not.toContain('super-secret')
  })

  it('round-trips a config through encrypt and decrypt', async () => {
    const config = JSON.stringify({ clientId: 'client', clientSecret: 'super-secret' })

    const stored = await encryptProviderConfig(config, 'oidcConfig')
    const loaded = await decryptProviderConfig(stored, 'oidcConfig')

    expect(JSON.parse(loaded as string)).toEqual({
      clientId: 'client',
      clientSecret: 'super-secret',
    })
  })

  it('encrypts both SAML key fields and ignores the public certificate', async () => {
    const stored = await encryptProviderConfig(
      JSON.stringify({ cert: 'public-cert', privateKey: 'sp-key', decryptionPvk: 'pvk' }),
      'samlConfig'
    )

    const parsed = JSON.parse(stored as string)
    expect(parsed.cert).toBe('public-cert')
    expect(parsed.privateKey).toBe(envelope(Buffer.from('sp-key').toString('hex')))
    expect(parsed.decryptionPvk).toBe(envelope(Buffer.from('pvk').toString('hex')))
  })

  it('leaves a value stored before encryption existed untouched', async () => {
    const legacy = JSON.stringify({ clientId: 'client', clientSecret: 'plain-text-secret' })

    await expect(decryptProviderConfig(legacy, 'oidcConfig')).resolves.toBe(legacy)
    expect(mockDecryptSecret).not.toHaveBeenCalled()
  })

  it('does not encrypt a value that is already encrypted', async () => {
    const stored = JSON.stringify({ clientSecret: envelope('deadbeef') })

    await expect(encryptProviderConfig(stored, 'oidcConfig')).resolves.toBe(stored)
    expect(mockEncryptSecret).not.toHaveBeenCalled()
  })

  it.each([
    ['a null column', null],
    ['an empty column', ''],
    ['an undefined column', undefined],
  ])('passes through %s', async (_label, value) => {
    await expect(encryptProviderConfig(value, 'oidcConfig')).resolves.toBe(value)
    await expect(decryptProviderConfig(value, 'oidcConfig')).resolves.toBe(value)
  })

  it.each([
    ['a config without the secret field', JSON.stringify({ clientId: 'client' })],
    ['a config whose secret is empty', JSON.stringify({ clientSecret: '' })],
    ['a config whose secret is not a string', JSON.stringify({ clientSecret: { a: 1 } })],
    ['a value that is not JSON', 'not json at all'],
    ['a JSON array', '[1,2,3]'],
  ])('passes through %s unchanged', async (_label, value) => {
    await expect(encryptProviderConfig(value, 'oidcConfig')).resolves.toBe(value)
    await expect(decryptProviderConfig(value, 'oidcConfig')).resolves.toBe(value)
    expect(mockEncryptSecret).not.toHaveBeenCalled()
  })

  it('fails loudly when a stored secret cannot be decrypted', async () => {
    mockDecryptSecret.mockRejectedValue(new Error('auth tag mismatch'))

    await expect(
      decryptProviderConfig(JSON.stringify({ clientSecret: envelope('deadbeef') }), 'oidcConfig')
    ).rejects.toThrow(/different ENCRYPTION_KEY/)
  })
})
