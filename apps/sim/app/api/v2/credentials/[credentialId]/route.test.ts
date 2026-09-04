/**
 * @vitest-environment node
 */
import {
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  remove: vi.fn(),
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/lib/credentials/application/service-account', () => ({
  deleteCredentialUseCase: {
    operation: { id: 'credentials.delete' },
    execute: mocks.remove,
  },
}))

import { PrincipalKindAuthorizationError } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { CredentialProviderOperationError } from '@/lib/credentials/application/credential-crud'
import { DELETE, PATCH } from '@/app/api/v2/credentials/[credentialId]/route'

vi.mock('@/lib/credentials/application/credential-crud', async () => {
  const { OrchestrationError: BaseError } = await import('@/lib/core/orchestration/types')
  class MockCredentialProviderOperationError extends BaseError {
    constructor(
      message: string,
      readonly providerErrorCode: string,
      readonly providerUnavailable: boolean
    ) {
      super('validation', message)
      this.name = 'CredentialProviderOperationError'
    }
  }
  return {
    CredentialProviderOperationError: MockCredentialProviderOperationError,
    updateWorkspaceCredentialUseCase: {
      operation: { id: 'credentials.update' },
      execute: mocks.update,
    },
  }
})

const WORKSPACE_ID = '11111111-2222-4333-8444-555555555555'
const CREDENTIAL_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7'

const auth = {
  principal: { kind: 'personal_api_key' as const, userId: 'user-1', keyId: 'key-1' },
  rateLimitSubjectIds: ['api-key:key-1', 'user:user-1'] as const,
  rateLimitSubscription: null,
  keyType: 'personal' as const,
}

const credential = {
  id: CREDENTIAL_ID,
  workspaceId: WORKSPACE_ID,
  type: 'service_account' as const,
  displayName: 'Zoom automation',
  description: null,
  providerId: 'zoom-service-account',
  accountId: null,
  envKey: null,
  envOwnerUserId: null,
  createdBy: 'user-1',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  encryptedServiceAccountKey: 'MUST_NOT_LEAK_CIPHERTEXT',
}

const context = { params: Promise.resolve({ credentialId: CREDENTIAL_ID }) }

function patchRequest(body: unknown, query = `?workspaceId=${WORKSPACE_ID}`): NextRequest {
  return new NextRequest(`http://localhost:3000/api/v2/credentials/${CREDENTIAL_ID}${query}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'x-api-key': 'secret' },
    body: JSON.stringify(body),
  })
}

describe('PATCH /api/v2/credentials/[credentialId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.update.mockResolvedValue({
      credential,
      access: { isAdmin: true },
      previousDisplayName: 'Zoom automation',
      updatedFields: ['encryptedServiceAccountKey'],
      auditMetadata: {},
    })
  })

  it('rotates secret material and returns the credential without it', async () => {
    const request = patchRequest({ clientSecret: 'rotated-secret' })
    const response = await PATCH(request, context)

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    const body = await response.text()
    expect(JSON.parse(body)).toEqual({
      data: {
        id: CREDENTIAL_ID,
        type: 'service_account',
        displayName: 'Zoom automation',
        description: null,
        providerId: 'zoom-service-account',
        accountId: null,
        hasServiceAccountKey: true,
        role: 'admin',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
    })
    expect(body).not.toContain('rotated-secret')
    expect(body).not.toContain('MUST_NOT_LEAK_CIPHERTEXT')
  })

  it('forwards a complete OCI rotation tuple and preserves explicit passphrase clearing', async () => {
    const request = patchRequest({
      tenancyOcid: 'ocid1.tenancy.oc1..tenant',
      userOcid: 'ocid1.user.oc1..replacement',
      fingerprint: '00:11:22:33:44:55:66:77:88:99:aa:bb:cc:dd:ee:ff',
      privateKey: '-----BEGIN PRIVATE KEY-----\nreplacement\n-----END PRIVATE KEY-----',
      region: 'us-ashburn-1',
    })
    const response = await PATCH(request, context)

    expect(response.status).toBe(200)
    expect(mocks.update).toHaveBeenCalledWith({
      principal: auth.principal,
      input: {
        tenancyOcid: 'ocid1.tenancy.oc1..tenant',
        userOcid: 'ocid1.user.oc1..replacement',
        fingerprint: '00:11:22:33:44:55:66:77:88:99:aa:bb:cc:dd:ee:ff',
        privateKey: '-----BEGIN PRIVATE KEY-----\nreplacement\n-----END PRIVATE KEY-----',
        region: 'us-ashburn-1',
        credentialId: CREDENTIAL_ID,
        assertedWorkspaceId: WORKSPACE_ID,
      },
      request,
    })
    expect(JSON.stringify(await response.json())).not.toContain('PRIVATE KEY')
  })

  it('asserts the workspace scope and preserves the credential id', async () => {
    const request = patchRequest({ displayName: 'Zoom prod' })
    await PATCH(request, context)

    expect(mocks.update).toHaveBeenCalledWith({
      principal: auth.principal,
      input: {
        displayName: 'Zoom prod',
        credentialId: CREDENTIAL_ID,
        assertedWorkspaceId: WORKSPACE_ID,
      },
      request,
    })
  })

  it('clears a description with an explicit null and leaves an omitted field alone', async () => {
    await PATCH(patchRequest({ description: null }), context)

    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ description: null }) })
    )
    expect(mocks.update.mock.calls[0][0].input).not.toHaveProperty('displayName')
  })

  it('rejects an empty patch rather than reporting a no-op success', async () => {
    const response = await PATCH(patchRequest({}), context)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'BAD_REQUEST' } })
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('rejects an undeclared body field', async () => {
    const response = await PATCH(patchRequest({ providerId: 'other-provider' }), context)

    expect(response.status).toBe(400)
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('requires the workspace assertion', async () => {
    const response = await PATCH(patchRequest({ displayName: 'Zoom prod' }, ''), context)

    expect(response.status).toBe(400)
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('refuses a workspace API key with 403 rather than acting on it', async () => {
    mocks.update.mockRejectedValue(
      new PrincipalKindAuthorizationError('workspace_api_key', 'credentials.update')
    )

    const response = await PATCH(patchRequest({ displayName: 'Zoom prod' }), context)

    expect(response.status).toBe(403)
  })

  /**
   * A provider that cannot be reached is transient. Rendering it as the `400`
   * the base `OrchestrationError('validation')` projects would tell the caller
   * its secret is permanently wrong and invite it to revoke a good credential.
   */
  it('answers a provider outage with 503 and a Retry-After', async () => {
    mocks.update.mockRejectedValue(
      new CredentialProviderOperationError('upstream unreachable', 'provider_unavailable', true)
    )

    const response = await PATCH(patchRequest({ clientSecret: 'rotated' }), context)

    expect(response.status).toBe(503)
    expect(response.headers.get('Retry-After')).not.toBeNull()
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Credential provider is temporarily unavailable',
      },
    })
  })

  it('answers a provider rejection with 400 and the provider code', async () => {
    mocks.update.mockRejectedValue(
      new CredentialProviderOperationError('invalid_credentials', 'invalid_credentials', false)
    )

    const response = await PATCH(patchRequest({ clientSecret: 'rotated' }), context)

    expect(response.status).toBe(400)
    expect(response.headers.get('Retry-After')).toBeNull()
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'BAD_REQUEST',
        message: 'invalid_credentials',
        details: { providerErrorCode: 'invalid_credentials' },
      },
    })
  })

  it('conceals a cross-tenant credential as a not-found', async () => {
    mocks.update.mockRejectedValue(new OrchestrationError('not_found', 'Credential not found'))

    const response = await PATCH(patchRequest({ displayName: 'Zoom prod' }), context)

    expect(response.status).toBe(404)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  })
})

describe('DELETE /api/v2/credentials/[credentialId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.remove.mockResolvedValue({ credential, deleted: true })
  })

  it('disconnects a credential through the application operation', async () => {
    const request = new NextRequest(
      `http://localhost:3000/api/v2/credentials/${CREDENTIAL_ID}?workspaceId=${WORKSPACE_ID}`,
      { method: 'DELETE' }
    )
    const response = await DELETE(request, context)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { id: CREDENTIAL_ID, deleted: true } })
    expect(mocks.remove).toHaveBeenCalledWith({
      principal: auth.principal,
      input: { workspaceId: WORKSPACE_ID, credentialId: CREDENTIAL_ID },
      request,
    })
  })

  it('requires the asserted workspace scope', async () => {
    const response = await DELETE(
      new NextRequest(`http://localhost:3000/api/v2/credentials/${CREDENTIAL_ID}`, {
        method: 'DELETE',
      }),
      context
    )

    expect(response.status).toBe(400)
    expect(mocks.remove).not.toHaveBeenCalled()
  })
})
