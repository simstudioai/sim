/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prepareOciNativeClient: vi.fn(),
  executeOciNativeOperation: vi.fn(),
}))
vi.mock('@/lib/internal/oci-object-storage-native/operations', () => mocks)

import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import { ociObjectStorageNativeSelectorAttachments } from '@/lib/selectors/server/providers/oci-object-storage-native'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'

function args(): ExecuteServerSelectorArgs {
  return {
    selectorKey: 'oci_object_storage_native.objects',
    context: {
      oauthCredential: 'visible-selection',
      bucketName: 'reports',
      namespace: 'namespace',
      prefix: ' 空/% ',
    },
    request: { kind: 'list', cursor: ' next/% ' },
    scope: { kind: 'workspace', workspaceId: 'trusted-workspace' },
    workspaceId: 'trusted-workspace',
    principal: { kind: 'session', userId: 'user', sessionId: 'session' },
    requesterUserId: 'user',
    credential: {
      suppliedId: 'visible-selection',
      providerId: 'oci-api-key-service-account',
      access: {
        ok: true,
        resolvedCredentialId: 'authorized',
        credentialType: 'service_account',
        workspaceId: 'trusted-workspace',
      },
    },
    references: new Map(),
    protectedValues: createSelectorProtectedValues(),
  }
}

async function execute(input: ExecuteServerSelectorArgs) {
  const key = input.selectorKey as keyof typeof ociObjectStorageNativeSelectorAttachments
  const attachment = ociObjectStorageNativeSelectorAttachments[key]
  if (attachment.destination === 'fixed') throw new Error('Expected prepared destination')
  const prepared = await attachment.destination.prepare(input)
  return attachment.execute(input, prepared)
}

describe('native OCI selectors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.prepareOciNativeClient.mockResolvedValue({
      client: 'prepared-client',
      endpoint: 'prepared-endpoint',
    })
    mocks.executeOciNativeOperation.mockResolvedValue({
      success: true,
      output: {
        objects: [{ name: ' 空/% ', size: 10, secret: 'not-projected' }],
        nextStartWith: 'next',
      },
    })
  })

  it('binds the authorized credential and workspace before projecting one object page', async () => {
    const result = await execute(args())
    expect(mocks.prepareOciNativeClient).toHaveBeenCalledWith(
      { credentialId: 'authorized', region: undefined },
      'trusted-workspace'
    )
    expect(mocks.executeOciNativeOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'list_objects',
        credentialId: 'authorized',
        bucketName: 'reports',
        prefix: ' 空/% ',
        start: ' next/% ',
        limit: 100,
      }),
      expect.objectContaining({ workspaceId: 'trusted-workspace' }),
      { client: 'prepared-client', endpoint: 'prepared-endpoint' }
    )
    expect(result).toEqual({
      kind: 'list',
      items: [{ id: ' 空/% ', label: ' 空/% ', meta: { size: 10 } }],
      nextCursor: 'next',
    })
  })

  it('uses native page tokens and required compartment scope for buckets', async () => {
    const input = args()
    input.selectorKey = 'oci_object_storage_native.buckets'
    input.context = { compartmentId: 'compartment', region: 'us-phoenix-1' }
    mocks.executeOciNativeOperation.mockResolvedValue({
      success: true,
      output: {
        buckets: [{ name: 'reports', compartmentId: 'not-projected' }],
        nextPage: 'page-2',
      },
    })
    expect(await execute(input)).toEqual({
      kind: 'list',
      items: [{ id: 'reports', label: 'reports' }],
      nextCursor: 'page-2',
    })
    expect(mocks.executeOciNativeOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'list_buckets',
        compartmentId: 'compartment',
        region: 'us-phoenix-1',
        page: ' next/% ',
      }),
      expect.anything(),
      expect.anything()
    )
    input.context.compartmentId = undefined
    await expect(execute(input)).rejects.toMatchObject({ name: 'SelectorContextUnavailableError' })
  })

  it('does not fall back to the visible credential or another credential provider', async () => {
    const input = args()
    input.credential = {
      suppliedId: 'visible-selection',
      providerId: 'oci-api-key-service-account',
    }
    await expect(execute(input)).rejects.toMatchObject({
      name: 'SelectorConnectionUnavailableError',
    })
    input.credential = {
      ...args().credential,
      suppliedId: 'visible-selection',
      providerId: 'oci-object-storage-service-account',
    }
    await expect(execute(input)).rejects.toMatchObject({
      name: 'SelectorConnectionUnavailableError',
    })
    expect(mocks.prepareOciNativeClient).not.toHaveBeenCalled()
  })

  it('rejects missing dependencies and oversized projections without collecting more pages', async () => {
    const input = args()
    input.context.bucketName = undefined
    await expect(execute(input)).rejects.toMatchObject({ name: 'SelectorContextUnavailableError' })
    expect(mocks.executeOciNativeOperation).not.toHaveBeenCalled()
    mocks.executeOciNativeOperation.mockResolvedValue({
      success: true,
      output: { objects: Array.from({ length: 101 }, (_, i) => ({ name: String(i) })) },
    })
    await expect(execute(args())).rejects.toMatchObject({ name: 'SelectorOptionsUnavailableError' })
    expect(mocks.executeOciNativeOperation).toHaveBeenCalledOnce()
  })

  it('preserves cancellation and rejects unsupported detail requests', async () => {
    const input = args()
    input.request = { kind: 'detail', id: 'report.txt' }
    await expect(execute(input)).rejects.toMatchObject({ name: 'SelectorOptionsUnavailableError' })
    const controller = new AbortController()
    controller.abort(new DOMException('Canceled', 'AbortError'))
    await expect(execute({ ...args(), signal: controller.signal })).rejects.toBe(
      controller.signal.reason
    )
    expect(mocks.executeOciNativeOperation).not.toHaveBeenCalled()
  })
})
