/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDecryptSecret, mockEncryptSecret } = vi.hoisted(() => ({
  mockDecryptSecret: vi.fn(),
  mockEncryptSecret: vi.fn(),
}))

vi.mock('@/lib/core/security/encryption', () => ({
  decryptSecret: mockDecryptSecret,
  encryptSecret: mockEncryptSecret,
}))

import {
  decryptQuickBooksOAuthClientConfig,
  encryptQuickBooksOAuthClientConfig,
  normalizeQuickBooksOAuthClientConfig,
  QuickBooksOAuthClientConfigurationError,
} from '@/lib/oauth/quickbooks-client-config'

describe('QuickBooks OAuth client configuration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('normalizes and encrypts the complete app configuration as one secret', async () => {
    mockEncryptSecret.mockResolvedValue({ encrypted: 'ciphertext', iv: 'iv' })

    await expect(
      encryptQuickBooksOAuthClientConfig({
        clientId: ' client-id ',
        clientSecret: ' client-secret ',
        environment: 'sandbox',
        webhookVerifierToken: ' verifier-token ',
      })
    ).resolves.toBe('ciphertext')
    expect(mockEncryptSecret).toHaveBeenCalledWith(
      JSON.stringify({
        clientId: 'client-id',
        clientSecret: 'client-secret',
        environment: 'sandbox',
        webhookVerifierToken: 'verifier-token',
      })
    )
  })

  it('decrypts and validates the stored configuration', async () => {
    mockDecryptSecret.mockResolvedValue({
      decrypted: JSON.stringify({
        clientId: 'client-id',
        clientSecret: 'client-secret',
        environment: 'production',
        webhookVerifierToken: 'verifier-token',
      }),
    })

    await expect(decryptQuickBooksOAuthClientConfig('ciphertext')).resolves.toEqual({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      environment: 'production',
      webhookVerifierToken: 'verifier-token',
    })
  })

  it('rejects incomplete, invalid, and malformed configurations', async () => {
    expect(() =>
      normalizeQuickBooksOAuthClientConfig({
        clientId: '',
        clientSecret: 'client-secret',
        environment: 'sandbox',
        webhookVerifierToken: 'verifier-token',
      })
    ).toThrow('QuickBooks client ID must be between 1 and 255 characters')

    expect(() =>
      normalizeQuickBooksOAuthClientConfig({
        clientId: 'client-id',
        clientSecret: 'client-secret',
        environment: 'sandbox',
        webhookVerifierToken: '',
      })
    ).toThrow('QuickBooks webhook verifier token must be between 1 and 512 characters')

    mockDecryptSecret.mockResolvedValueOnce({ decrypted: '{' })
    await expect(decryptQuickBooksOAuthClientConfig('malformed')).rejects.toMatchObject({
      name: 'QuickBooksOAuthClientConfigurationError',
      message: 'QuickBooks OAuth client configuration is invalid',
    })
  })

  it('does not reclassify encryption infrastructure failures as invalid configuration', async () => {
    const deploymentError = new Error('encryption key is unavailable')
    mockDecryptSecret.mockRejectedValue(deploymentError)

    await expect(decryptQuickBooksOAuthClientConfig('ciphertext')).rejects.toBe(deploymentError)
    expect(deploymentError).not.toBeInstanceOf(QuickBooksOAuthClientConfigurationError)
  })
})
