/**
 * @vitest-environment node
 */
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
  executeOnePasswordListVaults,
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

function response(options: {
  status?: number
  json?: unknown
  bytes?: Uint8Array
  contentType?: string
}) {
  const status = options.status ?? 200
  const bytes = options.bytes ?? new Uint8Array()
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-type' ? (options.contentType ?? null) : null,
    },
    body: null,
    json: async () => options.json ?? {},
    text: async () => '',
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  }
}

describe('1Password operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('preserves Connect provider statuses and forwards cancellation', async () => {
    const controller = new AbortController()
    clientMocks.connectRequest.mockResolvedValue(
      response({ status: 429, json: { message: 'rate limited' } })
    )

    await expect(
      executeOnePasswordListVaults(CONNECT_CREDENTIALS, { signal: controller.signal })
    ).rejects.toMatchObject<Partial<OnePasswordOperationError>>({
      status: 429,
      body: { error: 'rate limited' },
    })
    expect(clientMocks.connectRequest).toHaveBeenCalledWith({
      serverUrl: CONNECT_CREDENTIALS.serverUrl,
      apiKey: CONNECT_CREDENTIALS.apiKey,
      path: '/v1/vaults',
      method: 'GET',
      query: undefined,
      signal: controller.signal,
    })
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

  it('keeps Connect file content bounded and preserves the file envelope', async () => {
    const controller = new AbortController()
    clientMocks.connectRequest
      .mockResolvedValueOnce(response({ json: { name: 'secret.txt', size: 5 } }))
      .mockResolvedValueOnce(
        response({ bytes: new TextEncoder().encode('hello'), contentType: 'text/plain' })
      )

    const result = await executeOnePasswordGetItemFile(
      {
        ...CONNECT_CREDENTIALS,
        vaultId: 'vault-1',
        itemId: 'item-1',
        fileId: 'file-1',
      },
      { signal: controller.signal }
    )

    expect(result).toEqual({
      file: {
        name: 'secret.txt',
        mimeType: 'text/plain',
        data: Buffer.from('hello').toString('base64'),
        size: 5,
      },
    })
    expect(clientMocks.connectRequest.mock.calls[1]?.[0]).toMatchObject({
      maxResponseBytes: 5,
      signal: controller.signal,
    })
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

  it('propagates cancellation after an SDK call returns', async () => {
    const controller = new AbortController()
    clientMocks.createOnePasswordClient.mockResolvedValue({
      vaults: {
        list: vi.fn().mockImplementation(async () => {
          controller.abort(new DOMException('cancelled', 'AbortError'))
          return []
        }),
      },
    })

    await expect(
      executeOnePasswordListVaults(SERVICE_CREDENTIALS, { signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})
