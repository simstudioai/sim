/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockEncryptSecret, mockDecryptSecret } = vi.hoisted(() => ({
  mockEncryptSecret: vi.fn(),
  mockDecryptSecret: vi.fn(),
}))

vi.mock('@/lib/core/security/encryption', () => ({
  encryptSecret: mockEncryptSecret,
  decryptSecret: mockDecryptSecret,
}))

import type { CredentialGroupApiKeyField } from '@/lib/credential-groups/providers'
import {
  MAX_MANAGED_API_KEY_LENGTH,
  ManagedApiKeyFormatError,
  MIN_MANAGED_API_KEY_LENGTH,
  openManagedApiKeySecret,
  requireStorableManagedApiKeyFields,
  sealManagedApiKey,
} from '@/lib/credentials/managed-api-key'

const singleField: CredentialGroupApiKeyField[] = [
  { id: 'apiKey', label: 'API key', placeholder: '', secret: true },
]

const twoSecretFields: CredentialGroupApiKeyField[] = [
  { id: 'accessKey', label: 'Access key', placeholder: '', secret: true },
  { id: 'accessKeySecret', label: 'Access key secret', placeholder: '', secret: true },
]

const mixedFields: CredentialGroupApiKeyField[] = [
  { id: 'apiKey', label: 'API key', placeholder: '', secret: true },
  { id: 'subdomain', label: 'Subdomain', placeholder: '', secret: false },
]

describe('managed API key envelope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEncryptSecret.mockImplementation(async (value: string) => ({
      encrypted: `enc(${value})`,
      iv: 'iv',
    }))
  })

  describe('requireStorableManagedApiKeyFields', () => {
    it('trims every declared field', () => {
      expect(
        requireStorableManagedApiKeyFields(twoSecretFields, {
          accessKey: '  key-value-1  ',
          accessKeySecret: ' secret-value-1 ',
        })
      ).toEqual({ accessKey: 'key-value-1', accessKeySecret: 'secret-value-1' })
    })

    it('rejects a missing field rather than storing a partial credential', () => {
      expect(() =>
        requireStorableManagedApiKeyFields(twoSecretFields, { accessKey: 'key-value-1' })
      ).toThrow(ManagedApiKeyFormatError)
    })

    it('rejects an undeclared field rather than dropping it', () => {
      expect(() =>
        requireStorableManagedApiKeyFields(singleField, { apiKey: 'key-value-1', rogue: 'value' })
      ).toThrow(/Unexpected field rogue/)
    })

    it('holds each secret field to the redaction floor', () => {
      expect(() =>
        requireStorableManagedApiKeyFields(twoSecretFields, {
          accessKey: 'a'.repeat(MIN_MANAGED_API_KEY_LENGTH),
          accessKeySecret: 'a'.repeat(MIN_MANAGED_API_KEY_LENGTH - 1),
        })
      ).toThrow(/at least/)
    })

    /**
     * A subdomain is short and recurs in ordinary log lines, so it is never catalogued for
     * redaction — the floor that exists to keep unredactable secrets out would only reject
     * valid input here.
     */
    it('exempts a non-secret field from the redaction floor', () => {
      expect(
        requireStorableManagedApiKeyFields(mixedFields, {
          apiKey: 'a'.repeat(MIN_MANAGED_API_KEY_LENGTH),
          subdomain: 'acme',
        })
      ).toEqual({ apiKey: 'a'.repeat(MIN_MANAGED_API_KEY_LENGTH), subdomain: 'acme' })
    })

    it('still requires a non-secret field to be present', () => {
      expect(() =>
        requireStorableManagedApiKeyFields(mixedFields, {
          apiKey: 'a'.repeat(MIN_MANAGED_API_KEY_LENGTH),
          subdomain: '   ',
        })
      ).toThrow(/Subdomain is required/)
    })

    it('rejects a value past the ceiling', () => {
      expect(() =>
        requireStorableManagedApiKeyFields(singleField, {
          apiKey: 'a'.repeat(MAX_MANAGED_API_KEY_LENGTH + 1),
        })
      ).toThrow(ManagedApiKeyFormatError)
    })
  })

  it('seals every field inside one versioned envelope', async () => {
    await sealManagedApiKey({ accessKey: 'key-1', accessKeySecret: 'secret-1' })
    expect(mockEncryptSecret).toHaveBeenCalledWith(
      JSON.stringify({
        type: 'managed-api-key',
        version: 1,
        fields: { accessKey: 'key-1', accessKeySecret: 'secret-1' },
      })
    )
  })

  /**
   * The whole reason `openManagedApiKeySecret` exists: the trace registry catalogs whatever a
   * ciphertext decrypts to and redacts exactly that literal. A credential with two secrets needs
   * two entries — the envelope ciphertext would catalog the JSON document and redact neither.
   */
  it('returns one bare-value ciphertext per secret field', async () => {
    mockDecryptSecret.mockResolvedValue({
      decrypted: JSON.stringify({
        type: 'managed-api-key',
        version: 1,
        fields: { accessKey: 'key-1', accessKeySecret: 'secret-1' },
      }),
    })

    const opened = await openManagedApiKeySecret({ encryptedApiKey: 'enc(env)' }, twoSecretFields)

    expect(opened.fields).toEqual({ accessKey: 'key-1', accessKeySecret: 'secret-1' })
    expect(opened.provenanceEntries).toEqual([
      { name: 'accessKey', encryptedValue: 'enc(key-1)' },
      { name: 'accessKeySecret', encryptedValue: 'enc(secret-1)' },
    ])
    for (const entry of opened.provenanceEntries) {
      expect(entry.encryptedValue).not.toContain('managed-api-key')
    }
  })

  it('never catalogs a non-secret field for redaction', async () => {
    mockDecryptSecret.mockResolvedValue({
      decrypted: JSON.stringify({
        type: 'managed-api-key',
        version: 1,
        fields: { apiKey: 'key-1', subdomain: 'acme' },
      }),
    })

    const opened = await openManagedApiKeySecret({ encryptedApiKey: 'enc(env)' }, mixedFields)

    expect(opened.fields.subdomain).toBe('acme')
    expect(opened.provenanceEntries).toEqual([{ name: 'apiKey', encryptedValue: 'enc(key-1)' }])
  })

  it('rejects a payload that is not an envelope', async () => {
    mockDecryptSecret.mockResolvedValue({ decrypted: JSON.stringify({ apiKey: 'key-1' }) })
    await expect(openManagedApiKeySecret({ encryptedApiKey: 'x' }, singleField)).rejects.toThrow(
      ManagedApiKeyFormatError
    )
  })

  it('rejects a payload that is not JSON', async () => {
    mockDecryptSecret.mockResolvedValue({ decrypted: 'key-1' })
    await expect(openManagedApiKeySecret({ encryptedApiKey: 'x' }, singleField)).rejects.toThrow(
      ManagedApiKeyFormatError
    )
  })

  it('rejects an envelope from a future version', async () => {
    mockDecryptSecret.mockResolvedValue({
      decrypted: JSON.stringify({
        type: 'managed-api-key',
        version: 2,
        fields: { apiKey: 'key-1' },
      }),
    })
    await expect(openManagedApiKeySecret({ encryptedApiKey: 'x' }, singleField)).rejects.toThrow(
      ManagedApiKeyFormatError
    )
  })
})
