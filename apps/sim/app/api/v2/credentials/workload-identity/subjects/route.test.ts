/**
 * @vitest-environment node
 */
import { generateKeyPairSync } from 'node:crypto'
import type { Principal } from '@sim/auth/principal'
import {
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import {
  createPersonalApiKeyPrincipal,
  createWorkspaceApiKeyPrincipal,
} from '@sim/testing/factories/principal.factory'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceContextMock,
  workspaceContextMockFns,
} from '@sim/testing/mocks/workspace-context.mock'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/lib/workspaces/application/context', () => workspaceContextMock)
vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

import { env } from '@/lib/core/config/env'
import { verifyWorkloadIdentitySubject } from '@/lib/credentials/workload-identity/subject'
import { POST } from '@/app/api/v2/credentials/workload-identity/subjects/route'

const WORKSPACE_ID = '11111111-2222-4333-8444-555555555555'
const SIGNING_KEY = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
  type: 'pkcs8',
  format: 'pem',
})

function authenticateAs(principal: Principal) {
  v2RouteMocks.authenticate.mockResolvedValue({
    principal,
    rateLimitSubjectIds: ['subject-1'],
    rateLimitSubscription: null,
    keyType: principal.kind === 'workspace_api_key' ? 'workspace' : 'personal',
  })
}

function issue(body: Record<string, unknown>) {
  return POST(
    new NextRequest('http://localhost:3000/api/v2/credentials/workload-identity/subjects', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json', 'x-api-key': 'sk-sim-test' },
    })
  )
}

describe('POST /api/v2/credentials/workload-identity/subjects', () => {
  beforeEach(() => {
    Reflect.set(env, 'WORKLOAD_IDENTITY_SIGNING_KEY', SIGNING_KEY)
    Reflect.set(env, 'WORKLOAD_IDENTITY_ISSUER', 'https://sim.example.com/oidc/workload')
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    workspaceContextMockFns.mockLoadActiveWorkspaceApplicationContext.mockResolvedValue({
      workspaceId: WORKSPACE_ID,
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'user-1',
    })
    workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue('write')
    authenticateAs(createPersonalApiKeyPrincipal({ userId: 'user-1' }))
  })

  afterEach(() => {
    Reflect.set(env, 'WORKLOAD_IDENTITY_SIGNING_KEY', undefined)
    Reflect.set(env, 'WORKLOAD_IDENTITY_ISSUER', undefined)
  })

  it('issues a personal key a proof only that key’s user can create the credential with', async () => {
    const response = await issue({ workspaceId: WORKSPACE_ID, providerId: 'aws-service-account' })

    expect(response.status).toBe(200)
    const { data } = await response.json()
    expect(data).toEqual({
      issuer: 'https://sim.example.com/oidc/workload',
      audience: 'sts.amazonaws.com',
      subject: expect.stringMatching(`^sim:workspace:${WORKSPACE_ID}:credential:`),
      subjectProof: expect.any(String),
      expiresAt: expect.any(String),
      keylessConfig: {
        authType: 'oidc_role',
        subject: data.subject,
        subjectProof: data.subjectProof,
      },
      requiredConfigFields: ['roleArn'],
      optionalConfigFields: ['stsRegion', 'sessionDurationSeconds', 'audience'],
    })

    const owner = { workspaceId: WORKSPACE_ID }
    expect(() =>
      verifyWorkloadIdentitySubject('aws', owner, 'user-1', data.subject, data.subjectProof)
    ).not.toThrow()
    expect(() =>
      verifyWorkloadIdentitySubject('aws', owner, 'user-2', data.subject, data.subjectProof)
    ).toThrow(expect.objectContaining({ detailCode: 'WORKLOAD_IDENTITY_PROOF_INVALID' }))
    expect(() =>
      verifyWorkloadIdentitySubject('databricks', owner, 'user-1', data.subject, data.subjectProof)
    ).toThrow(expect.objectContaining({ detailCode: 'WORKLOAD_IDENTITY_PROOF_INVALID' }))
  })

  it('leaves the audience out for Google Cloud, whose audience is per credential', async () => {
    const response = await issue({
      workspaceId: WORKSPACE_ID,
      providerId: 'google-service-account',
    })

    const { data } = await response.json()
    expect(data).not.toHaveProperty('audience')
    expect(data.requiredConfigFields).toEqual([
      'projectNumber',
      'poolId',
      'providerId',
      'serviceAccountEmail',
    ])
  })

  it('refuses a workspace API key, whose subject would belong to no person', async () => {
    authenticateAs(createWorkspaceApiKeyPrincipal({ workspaceId: WORKSPACE_ID }))

    const response = await issue({ workspaceId: WORKSPACE_ID, providerId: 'aws-service-account' })

    expect(response.status).toBe(403)
    expect((await response.json()).error).toMatchObject({
      code: 'FORBIDDEN',
      details: { code: 'WORKSPACE_KEY_OPERATION_NOT_PERMITTED' },
    })
  })

  it('refuses an OAuth token without the api:write scope', async () => {
    authenticateAs({
      kind: 'oauth_access_token',
      userId: 'user-1',
      clientId: 'client-1',
      tokenId: 'token-1',
      scopes: ['api:read'],
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    })

    const response = await issue({ workspaceId: WORKSPACE_ID, providerId: 'aws-service-account' })

    expect(response.status).toBe(403)
    expect((await response.json()).error).toMatchObject({
      code: 'FORBIDDEN',
      details: { code: 'INSUFFICIENT_SCOPE' },
    })
  })

  it('rejects a provider with no keyless mode before issuing anything', async () => {
    const response = await issue({ workspaceId: WORKSPACE_ID, providerId: 'zoom-service-account' })

    expect(response.status).toBe(400)
    expect((await response.json()).error.code).toBe('BAD_REQUEST')
    expect(workspaceContextMockFns.mockLoadActiveWorkspaceApplicationContext).not.toHaveBeenCalled()
  })

  it('names the missing deployment support with a stable code', async () => {
    Reflect.set(env, 'WORKLOAD_IDENTITY_SIGNING_KEY', undefined)

    const response = await issue({ workspaceId: WORKSPACE_ID, providerId: 'aws-service-account' })

    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatchObject({
      code: 'BAD_REQUEST',
      message:
        'Keyless connections are not available on this deployment. Use a key- or token-based credential.',
      details: { code: 'WORKLOAD_IDENTITY_NOT_CONFIGURED' },
    })
  })

  it.each([
    [
      'the caller cannot reach',
      () => workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue(null),
    ],
    [
      'does not exist',
      () =>
        workspaceContextMockFns.mockLoadActiveWorkspaceApplicationContext.mockResolvedValue(null),
    ],
  ])('answers a workspace that %s as not found', async (_label, arrange) => {
    arrange()

    const response = await issue({ workspaceId: WORKSPACE_ID, providerId: 'aws-service-account' })

    expect(response.status).toBe(404)
    expect((await response.json()).error).toEqual({
      code: 'NOT_FOUND',
      message: 'Workspace not found',
    })
  })

  it('refuses a caller over that bucket before issuing a subject', async () => {
    v2RouteMocks.operationRate.mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetAt: new Date(Date.now() + 30_000),
    })

    const response = await issue({ workspaceId: WORKSPACE_ID, providerId: 'aws-service-account' })

    expect(response.status).toBe(429)
    expect((await response.json()).error.code).toBe('RATE_LIMITED')
    expect(workspaceContextMockFns.mockLoadActiveWorkspaceApplicationContext).not.toHaveBeenCalled()
  })
})
