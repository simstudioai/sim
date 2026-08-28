/**
 * @vitest-environment node
 */
import { createEnvMock } from '@sim/testing'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/config/env', () =>
  createEnvMock({
    ENCRYPTION_KEY: '0123456789abcdef'.repeat(4),
  })
)

import { decrypt } from '@sim/security/encryption'
import { decryptSecret } from '@/lib/core/security/encryption'
import {
  AccountTokenDecryptionError,
  decryptAccountToken,
  encryptAccountToken,
  isEncryptedAccountToken,
} from '@/lib/oauth/account-token-crypto'

/**
 * The value shapes these columns hold. What each assertion depends on is the character
 * class and delimiters, not the provider — so the fixtures reproduce the shape without
 * reproducing any provider's token prefix, which secret scanning rejects on every push.
 *
 * The hex entry is the load-bearing one: it is exactly what Better Auth's own
 * `isLikelyEncrypted` misreads as an envelope.
 */
const TOKEN_SHAPES = [
  ['dotted opaque, as Google issues', 'token.placeholder-value-with-dots'],
  ['three dot-separated segments, as an OIDC id token', 'header.payload.signature'],
  ['dash-delimited, as Slack issues', 'bot-placeholder-0000-token-value'],
  ['underscore-prefixed, as Shopify issues', 'admin_placeholder_token_value'],
  ['a bare hostname, which Shopify stores in id_token', 'my-test-store.myshopify.com'],
  ['underscore-prefixed, as GitHub issues', 'classic_placeholdertokenvalue'],
  ['even-length hex, as Trello issues', 'a1b2c3d4'.repeat(4)],
  ['dotted with underscores, as Microsoft issues', '0.placeholder_token_value'],
] as const

describe('isEncryptedAccountToken', () => {
  it.each(TOKEN_SHAPES)('does not classify a %s token as ciphertext', (_label, token) => {
    expect(isEncryptedAccountToken(token)).toBe(false)
  })

  /**
   * A legacy token that merely begins `simenc:` is not one of ours. Matching the version
   * too keeps it classified as plaintext instead of an envelope this build cannot read —
   * which would leave it unencrypted on write and unavailable on read.
   */
  it.each([
    ['no version segment', 'simenc:legacy-opaque-value'],
    ['a non-numeric version', 'simenc:vX:legacy'],
    ['the bare prefix', 'simenc:'],
  ])('treats a legacy value with %s as plaintext, not an envelope', (_label, value) => {
    expect(isEncryptedAccountToken(value)).toBe(false)
  })

  it('classifies an envelope as ciphertext', async () => {
    expect(isEncryptedAccountToken(await encryptAccountToken('secret'))).toBe(true)
  })
})

describe('envelope wire format', () => {
  const KEY = Buffer.from('0123456789abcdef'.repeat(4), 'hex')

  /**
   * The stored format is a compatibility contract: the backfill and any future key rotation
   * both parse it, so its shape is pinned here rather than left to the implementation.
   */
  it('is `simenc:v1:` followed by exactly iv:ciphertext:authTag', async () => {
    const [scheme, version, ...rest] = (await encryptAccountToken('token.placeholder-value')).split(
      ':'
    )

    expect(scheme).toBe('simenc')
    expect(version).toBe('v1')
    expect(rest).toHaveLength(3)
    expect(rest[0]).toMatch(/^[0-9a-f]{32}$/)
    expect(rest[1]).toMatch(/^[0-9a-f]+$/)
    expect(rest[2]).toMatch(/^[0-9a-f]{32}$/)
  })

  it('leaves a payload the shared primitive can decrypt once the prefix is stripped', async () => {
    const payload = (await encryptAccountToken('token.placeholder-value')).slice(
      'simenc:v1:'.length
    )
    await expect(decrypt(payload, KEY)).resolves.toEqual({ decrypted: 'token.placeholder-value' })
  })

  it('never leaves the plaintext visible in the stored value', async () => {
    await expect(encryptAccountToken('super-secret-refresh')).resolves.not.toContain('super-secret')
  })

  it.each([
    ['a 4KB token', 'x'.repeat(4096)],
    ['unicode', '토큰-🔐-Ünïcode'],
  ])('round-trips %s', async (_label, token) => {
    expect(await decryptAccountToken(await encryptAccountToken(token), 'accessToken')).toBe(token)
  })
})

describe('encryptAccountToken', () => {
  it('produces a v1 envelope that round-trips', async () => {
    const encrypted = await encryptAccountToken('token.placeholder-value')

    expect(encrypted.startsWith('simenc:v1:')).toBe(true)
    expect(encrypted).not.toContain('token.placeholder-value')
    await expect(decryptAccountToken(encrypted, 'accessToken')).resolves.toBe(
      'token.placeholder-value'
    )
  })

  it('is idempotent so a re-encrypted value is never double-wrapped', async () => {
    const once = await encryptAccountToken('token')
    const twice = await encryptAccountToken(once)

    expect(twice).toBe(once)
    await expect(decryptAccountToken(twice, 'accessToken')).resolves.toBe('token')
  })

  it.each([
    ['empty string', ''],
    ['null', null],
    ['undefined', undefined],
  ])('passes %s through untouched', async (_label, value) => {
    await expect(encryptAccountToken(value as string)).resolves.toBe(value)
  })

  it('produces different ciphertext for the same plaintext', async () => {
    expect(await encryptAccountToken('same')).not.toBe(await encryptAccountToken('same'))
  })

  it.each(TOKEN_SHAPES)('round-trips a %s token', async (_label, token) => {
    const encrypted = await encryptAccountToken(token)
    await expect(decryptAccountToken(encrypted, 'accessToken')).resolves.toBe(token)
  })
})

describe('decryptAccountToken', () => {
  it.each(TOKEN_SHAPES)('returns legacy plaintext %s unchanged', async (_label, token) => {
    await expect(decryptAccountToken(token, 'accessToken')).resolves.toBe(token)
  })

  it.each([
    ['empty string', ''],
    ['null', null],
    ['undefined', undefined],
  ])('passes %s through untouched', async (_label, value) => {
    await expect(decryptAccountToken(value as string, 'accessToken')).resolves.toBe(value)
  })

  it.each([
    ['no version segment', 'simenc:legacy-opaque-value'],
    ['the bare prefix', 'simenc:'],
  ])('passes a legacy value with %s through unchanged', async (_label, value) => {
    await expect(decryptAccountToken(value, 'accessToken')).resolves.toBe(value)
  })

  it('throws on an unknown envelope version rather than passing it through', async () => {
    await expect(decryptAccountToken('simenc:v2:deadbeef', 'refreshToken')).rejects.toThrow(
      AccountTokenDecryptionError
    )
    await expect(decryptAccountToken('simenc:v2:deadbeef', 'refreshToken')).rejects.toMatchObject({
      field: 'refreshToken',
      reason: 'unknown-version',
    })
  })

  it('throws when the auth tag has been tampered with', async () => {
    const encrypted = await encryptAccountToken('token')
    const [iv, ciphertext] = encrypted.slice('simenc:v1:'.length).split(':')
    const forged = `simenc:v1:${iv}:${ciphertext}:${'0'.repeat(32)}`

    await expect(decryptAccountToken(forged, 'accessToken')).rejects.toMatchObject({
      field: 'accessToken',
      reason: 'decrypt-failed',
    })
  })

  it('throws when the payload is truncated', async () => {
    await expect(decryptAccountToken('simenc:v1:abc', 'idToken')).rejects.toMatchObject({
      reason: 'decrypt-failed',
    })
  })

  /**
   * `decryptSecret` splits on `:` and reads the first segment as the IV, so a full
   * envelope handed to it directly parses `'simenc'` as IV hex. The accessor must
   * strip the prefix; this pins the failure so a future refactor cannot reintroduce it.
   */
  it('confirms the raw primitive cannot consume a prefixed envelope', async () => {
    const encrypted = await encryptAccountToken('token')
    await expect(decryptSecret(encrypted)).rejects.toThrow()
  })
})
