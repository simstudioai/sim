/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ create: vi.fn(), prepare: vi.fn(), request: vi.fn() }))
vi.mock('@/lib/internal/oci/client.server', () => ({ createOciClient: mocks.create }))

import type { OciAuthenticatedResponse } from '@/lib/internal/oci/client.server'
import {
  OCI_FUNCTIONS_MANAGEMENT_POLICY,
  ociFunctionsResponseMetadata,
  prepareOciFunctionsClient,
  projectOciFunctionsResource,
  requestOciFunctionsManagement,
} from '@/lib/internal/oci-functions/client'

function response(body: unknown, status = 200): OciAuthenticatedResponse {
  return {
    status,
    headers: { etag: 'v1', 'opc-next-page': 'page-2' },
    opcRequestId: 'request-1',
    body: new TextEncoder().encode(JSON.stringify(body)),
  } as OciAuthenticatedResponse
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.prepare.mockResolvedValue({ origin: 'https://functions.us-ashburn-1.oci.oraclecloud.com' })
  mocks.create.mockResolvedValue({ prepareStaticEndpoint: mocks.prepare, request: mocks.request })
})

describe('OCI Functions client adapter', () => {
  it('binds the authorized credential, trusted workspace, fixed service, and management policy', async () => {
    await prepareOciFunctionsClient({
      credentialId: 'resolved-id',
      workspaceId: 'workspace-1',
      region: 'us-ashburn-1',
    })
    expect(mocks.create).toHaveBeenCalledWith({
      credentialId: 'resolved-id',
      workspaceId: 'workspace-1',
      region: 'us-ashburn-1',
      serviceId: 'oci-functions',
    })
    expect(mocks.prepare).toHaveBeenCalledWith(OCI_FUNCTIONS_MANAGEMENT_POLICY)
    expect(OCI_FUNCTIONS_MANAGEMENT_POLICY.hostnameTemplate).toBe('regional-oci')
  })

  it('retains an omitted region for credential-default selection', async () => {
    await prepareOciFunctionsClient({ credentialId: 'resolved-id', workspaceId: 'workspace-1' })
    expect(mocks.create).toHaveBeenCalledWith({
      credentialId: 'resolved-id',
      workspaceId: 'workspace-1',
      serviceId: 'oci-functions',
    })
  })

  it('projects documented details and strips fields not in the Oracle response contract', () => {
    const result = projectOciFunctionsResource(
      response({
        id: 'fn-1',
        config: { ENV: 'prod' },
        invokeEndpoint: 'https://oracle.example',
        privateCanary: 'hidden',
        traceConfig: { isEnabled: false, privateCanary: 'hidden' },
      }),
      'functions'
    )
    expect(result).toEqual({
      id: 'fn-1',
      config: { ENV: 'prod' },
      invokeEndpoint: 'https://oracle.example',
      traceConfig: { isEnabled: false },
    })
    expect(
      projectOciFunctionsResource(
        response([
          {
            id: 'app-1',
            config: { hidden: 'summary omits config' },
            syslogUrl: 'summary omits syslog',
          },
        ]),
        'applications',
        true
      )
    ).toEqual([{ id: 'app-1' }])
  })

  it('rejects malformed resource envelopes without leaking provider content', () => {
    expect(() => projectOciFunctionsResource(response({ secret: 'canary' }), 'functions')).toThrow(
      'Invalid OCI Functions resource response'
    )
    expect(() =>
      projectOciFunctionsResource(response({ items: [] }), 'applications', true)
    ).toThrow('Invalid OCI Functions resource response')
  })

  it('preserves documented pagination and concurrency headers', () => {
    expect(ociFunctionsResponseMetadata(response({}))).toEqual({
      status: 200,
      etag: 'v1',
      nextPage: 'page-2',
      opcRequestId: 'request-1',
    })
  })

  it('does not parse an empty 204 response and sends no DELETE body or retry policy', async () => {
    const prepared = await prepareOciFunctionsClient({
      credentialId: 'resolved-id',
      workspaceId: 'workspace-1',
    })
    mocks.request.mockResolvedValue({ status: 204, headers: {}, body: new Uint8Array() })
    await requestOciFunctionsManagement(prepared, {
      method: 'DELETE',
      path: '/20181201/functions/function-1',
      ifMatch: 'v1',
    })
    const request = mocks.request.mock.calls[0][0]
    expect(request).toMatchObject({ method: 'DELETE', headers: { 'if-match': 'v1' } })
    expect(request).not.toHaveProperty('body')
    expect(request).not.toHaveProperty('retry')
  })
})
