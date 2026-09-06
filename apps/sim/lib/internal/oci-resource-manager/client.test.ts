/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ create: vi.fn(), prepare: vi.fn(), request: vi.fn() }))
vi.mock('@/lib/internal/oci/client.server', () => ({ createOciClient: mocks.create }))

import {
  OCI_RESOURCE_MANAGER_FILE_LIMIT,
  OCI_RESOURCE_MANAGER_POLICY,
  prepareOciResourceManagerClient,
  requestResourceManager,
  resourcePath,
} from '@/lib/internal/oci-resource-manager/client'

beforeEach(() => {
  vi.resetAllMocks()
  mocks.create.mockResolvedValue({ prepareStaticEndpoint: mocks.prepare, request: mocks.request })
  mocks.prepare.mockResolvedValue({
    origin: 'https://resourcemanager.us-ashburn-1.oraclecloud.com',
  })
  mocks.request.mockResolvedValue({ status: 200, headers: {}, body: new Uint8Array() })
})
async function prepared() {
  return prepareOciResourceManagerClient({ credentialId: 'resolved', workspaceId: 'workspace' })
}
describe('Resource Manager foundation adapter', () => {
  it('uses the existing credential client and a static Resource Manager endpoint policy', async () => {
    await prepared()
    expect(mocks.create).toHaveBeenCalledWith({
      credentialId: 'resolved',
      workspaceId: 'workspace',
      serviceId: 'oci-resource-manager',
    })
    expect(mocks.prepare).toHaveBeenCalledWith(OCI_RESOURCE_MANAGER_POLICY)
    expect(resourcePath('jobs', 'a/b+c')).toBe('/20180917/jobs/a%2Fb%2Bc')
  })
  it('preserves repeated query values and work-request/pagination headers', async () => {
    await requestResourceManager(await prepared(), {
      method: 'GET',
      path: '/20180917/jobs',
      query: [
        ['type', 'a'],
        ['type', 'b'],
      ],
    })
    expect(mocks.request).toHaveBeenCalledWith(
      expect.objectContaining({
        queryPairs: [
          ['type', 'a'],
          ['type', 'b'],
        ],
        responseHeaders: ['opc-next-page', 'opc-work-request-id'],
        retry: { kind: 'safe', maxAttempts: 2 },
      })
    )
  })
  it('sends bodyless read POSTs as empty bytes without assigning safe POST retries', async () => {
    await requestResourceManager(await prepared(), {
      method: 'POST',
      path: '/20180917/stacks/s/actions/listResourceDriftDetails',
    })
    expect(mocks.request).toHaveBeenCalledWith(
      expect.objectContaining({
        body: new Uint8Array(),
        contentType: 'application/json',
        retry: undefined,
      })
    )
  })
  it('passes a stable explicit token only through the foundation retry policy', async () => {
    await requestResourceManager(await prepared(), {
      method: 'POST',
      path: '/20180917/jobs',
      body: { stackId: 'stack' },
      retryToken: 'same-logical-request',
    })
    expect(mocks.request).toHaveBeenCalledWith(
      expect.objectContaining({
        retry: { kind: 'tokenized', maxAttempts: 2, retryToken: 'same-logical-request' },
      })
    )
    expect(new TextDecoder().decode(mocks.request.mock.calls[0][0].body)).toBe(
      '{"stackId":"stack"}'
    )
  })
  it('accepts empty cancellation responses and caps binary reads without JSON parsing', async () => {
    mocks.request.mockResolvedValueOnce({ status: 202, headers: {}, body: new Uint8Array() })
    await requestResourceManager(await prepared(), {
      method: 'DELETE',
      path: resourcePath('jobs', 'job'),
      expectedStatus: 202,
      ifMatch: 'etag',
    })
    expect(mocks.request).toHaveBeenLastCalledWith(
      expect.objectContaining({ method: 'DELETE', headers: { 'if-match': 'etag' } })
    )
    expect(mocks.request.mock.calls[0][0]).not.toHaveProperty('body')
    await requestResourceManager(await prepared(), {
      method: 'GET',
      path: resourcePath('jobs', 'job', '/tfState'),
      binary: true,
    })
    expect(mocks.request).toHaveBeenLastCalledWith(
      expect.objectContaining({ maxResponseBytes: OCI_RESOURCE_MANAGER_FILE_LIMIT })
    )
  })
})
