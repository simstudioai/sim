import { beforeEach, describe, expect, it, vi } from 'vitest'

const clientMocks = vi.hoisted(() => ({
  connectItemToSdkItem: vi.fn(),
  connectRequest: vi.fn(),
  createOnePasswordClient: vi.fn(),
  findItemFileAttributes: vi.fn(),
  matchesFilter: vi.fn(),
  normalizeSdkItem: vi.fn(),
  normalizeSdkItemOverview: vi.fn(),
  normalizeSdkVault: vi.fn(),
  resolveCredentials: vi.fn(),
  toSdkCategory: vi.fn(),
  toSdkFieldType: vi.fn(),
}))

vi.mock('@/lib/internal/onepassword/client', () => clientMocks)
vi.mock('@/lib/uploads/utils/validation', () => ({ MAX_FILE_SIZE: 5 }))

import type { OnePasswordOperationError } from '@/lib/internal/onepassword/errors'
import {
  executeOnePasswordGetItemFile,
  executeOnePasswordResolveSecret,
  executeOnePasswordUpdateItem,
} from '@/lib/internal/onepassword/operations'

const SERVICE_CREDENTIALS = {
  connectionMode: 'service_account' as const,
  serviceAccountToken: 'not-a-real-service-account-token',
}

const CONNECT_CREDENTIALS = {
  connectionMode: 'connect' as const,
  serverUrl: 'https://connect.example.com',
  apiKey: 'not-a-real-connect-token',
}

describe('1Password operations', () => {
  beforeEach(() => {
    clientMocks.resolveCredentials.mockImplementation((input: { connectionMode?: string }) =>
      input.connectionMode === 'connect'
        ? {
            mode: 'connect',
            serverUrl: CONNECT_CREDENTIALS.serverUrl,
            apiKey: CONNECT_CREDENTIALS.apiKey,
          }
        : {
            mode: 'service_account',
            serviceAccountToken: SERVICE_CREDENTIALS.serviceAccountToken,
          }
    )
    clientMocks.normalizeSdkVault.mockImplementation((vault) => vault)
    clientMocks.normalizeSdkItem.mockImplementation((item) => item)
    clientMocks.connectItemToSdkItem.mockImplementation((item) => item)
  })

  it('preserves ID-aware JSON Patch semantics before an SDK update', async () => {
    const existing = {
      id: 'item-1',
      title: 'Login',
      fields: [{ id: 'password', value: 'old' }],
    }
    const put = vi.fn().mockImplementation(async (item) => item)
    clientMocks.createOnePasswordClient.mockResolvedValue({
      items: {
        get: vi.fn().mockResolvedValue(existing),
        put,
      },
    })

    await executeOnePasswordUpdateItem(
      {
        ...SERVICE_CREDENTIALS,
        vaultId: 'vault-1',
        itemId: 'item-1',
        operations: '[{"op":"replace","path":"/fields/password/value","value":"new"}]',
      },
      {}
    )

    expect(clientMocks.connectItemToSdkItem).toHaveBeenCalledWith(
      expect.objectContaining({
        fields: [{ id: 'password', value: 'new' }],
      }),
      existing
    )
    expect(put).toHaveBeenCalledOnce()
  })

  it('bounds SDK file reads before and after materialization', async () => {
    const read = vi.fn().mockResolvedValue(new Uint8Array(6))
    clientMocks.createOnePasswordClient.mockResolvedValue({
      items: {
        get: vi.fn().mockResolvedValue({ id: 'item-1' }),
        files: { read },
      },
    })
    clientMocks.findItemFileAttributes.mockReturnValue({
      id: 'file-1',
      name: 'secret.bin',
      size: 5,
    })

    await expect(
      executeOnePasswordGetItemFile(
        {
          ...SERVICE_CREDENTIALS,
          vaultId: 'vault-1',
          itemId: 'item-1',
          fileId: 'file-1',
        },
        {}
      )
    ).rejects.toThrow('1Password item file exceeds maximum size of 5 bytes')

    clientMocks.findItemFileAttributes.mockReturnValueOnce({
      id: 'file-1',
      name: 'secret.bin',
      size: 6,
    })
    await expect(
      executeOnePasswordGetItemFile(
        {
          ...SERVICE_CREDENTIALS,
          vaultId: 'vault-1',
          itemId: 'item-1',
          fileId: 'file-1',
        },
        {}
      )
    ).rejects.toThrow('1Password item file exceeds maximum size of 5 bytes')
    expect(read).toHaveBeenCalledOnce()
  })

  it('preserves the private secret value and rejects Connect mode', async () => {
    const resolve = vi.fn().mockResolvedValue('resolved-secret')
    clientMocks.createOnePasswordClient.mockResolvedValue({ secrets: { resolve } })

    await expect(
      executeOnePasswordResolveSecret(
        { ...SERVICE_CREDENTIALS, secretReference: 'op://vault/item/password' },
        {}
      )
    ).resolves.toEqual({
      value: 'resolved-secret',
      reference: 'op://vault/item/password',
    })

    await expect(
      executeOnePasswordResolveSecret(
        { ...CONNECT_CREDENTIALS, secretReference: 'op://vault/item/password' },
        {}
      )
    ).rejects.toMatchObject<Partial<OnePasswordOperationError>>({
      status: 400,
      body: { error: 'Resolve Secret is only available in Service Account mode' },
    })
  })
})
