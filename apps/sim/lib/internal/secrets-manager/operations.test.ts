/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCreateSecretsManagerClient, mockDestroy, mockListSecrets } = vi.hoisted(() => ({
  mockCreateSecretsManagerClient: vi.fn(),
  mockDestroy: vi.fn(),
  mockListSecrets: vi.fn(),
}))

vi.mock('@/lib/internal/secrets-manager/client', () => ({
  createSecret: vi.fn(),
  createSecretsManagerClient: mockCreateSecretsManagerClient,
  deleteSecret: vi.fn(),
  describeSecret: vi.fn(),
  getSecretValue: vi.fn(),
  listSecrets: mockListSecrets,
  restoreSecret: vi.fn(),
  rotateSecret: vi.fn(),
  tagResource: vi.fn(),
  untagResource: vi.fn(),
  updateSecretValue: vi.fn(),
}))

import { executeSecretsManagerListSecrets } from '@/lib/internal/secrets-manager/operations'

const INPUT = {
  region: 'us-east-1',
  accessKeyId: 'access-key',
  secretAccessKey: 'secret-key',
  maxResults: 10,
  nextToken: 'next-token',
}

describe('Secrets Manager operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateSecretsManagerClient.mockReturnValue({ destroy: mockDestroy })
  })

  it('forwards cancellation and destroys the AWS client after success', async () => {
    const controller = new AbortController()
    const result = { secrets: [], nextToken: null, count: 0 }
    mockListSecrets.mockResolvedValue(result)

    await expect(executeSecretsManagerListSecrets(INPUT, controller.signal)).resolves.toBe(result)
    expect(mockListSecrets).toHaveBeenCalledWith(
      { destroy: mockDestroy },
      10,
      'next-token',
      controller.signal
    )
    expect(mockDestroy).toHaveBeenCalledOnce()
  })

  it('destroys the AWS client when provider execution fails', async () => {
    mockListSecrets.mockRejectedValue(new Error('provider failure'))

    await expect(executeSecretsManagerListSecrets(INPUT)).rejects.toThrow('provider failure')
    expect(mockDestroy).toHaveBeenCalledOnce()
  })
})
