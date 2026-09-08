/**
 * @vitest-environment node
 */
import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  checkRateLimitDirect: vi.fn(),
  enforceIpRateLimit: vi.fn(),
}))

vi.mock('@/ee/scim/lib/base-url', () => ({ scimBaseUrl: () => 'https://sim.test/api/scim/v2' }))

vi.mock('@/lib/core/rate-limiter', () => ({
  RateLimiter: class {
    checkRateLimitDirect = mocks.checkRateLimitDirect
  },
  enforceIpRateLimit: mocks.enforceIpRateLimit,
}))

import type { ScimConnectionPrincipal } from '@sim/auth/principal'
import {
  createScimUserContract,
  deleteScimUserContract,
  listScimUsersContract,
} from '@/lib/api/contracts/scim'
import { createScimRouteBuilder } from '@/lib/api/server/routes'
import { scimOperations } from '@/ee/scim/lib/application/operations'
import { SCIM_MEDIA_TYPE } from '@/ee/scim/lib/protocol/constants'
import { ScimError } from '@/ee/scim/lib/protocol/errors'

const principal: ScimConnectionPrincipal = {
  kind: 'scim_connection',
  organizationId: 'org-1',
  connectionId: 'conn-1',
  credentialId: 'cred-1',
  scopes: ['users:read', 'users:write'],
}

const authenticate = vi.fn()
const recordRequest = vi.fn()
const defineScimRoute = createScimRouteBuilder({
  authenticate,
  recordRequest,
})

const listUsers = defineScimRoute({
  contract: listScimUsersContract,
  operation: scimOperations.listUsers,
  useCase: { operation: scimOperations.listUsers, execute: vi.fn() },
  mapInput: () => ({}),
  present: () => ({
    schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
    totalResults: 0,
    startIndex: 1,
    itemsPerPage: 0,
    Resources: [],
  }),
})

const createUser = defineScimRoute({
  contract: createScimUserContract,
  operation: scimOperations.provisionUser,
  useCase: { operation: scimOperations.provisionUser, execute: vi.fn().mockResolvedValue({}) },
  mapInput: () => ({}),
  present: () => ({
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
    id: 'su-1',
    meta: {
      resourceType: 'User',
      created: '2026-01-01T00:00:00.000Z',
      lastModified: '2026-01-01T00:00:00.000Z',
      location: 'https://sim.test/api/scim/v2/Users/su-1',
      version: 'W/"1"',
    },
  }),
  headers: () => ({ Location: 'https://sim.test/api/scim/v2/Users/su-1' }),
})

const deleteUser = defineScimRoute({
  contract: deleteScimUserContract,
  operation: scimOperations.deprovisionUser,
  useCase: { operation: scimOperations.deprovisionUser, execute: vi.fn().mockResolvedValue({}) },
  mapInput: () => ({}),
})

const withParams = { params: Promise.resolve({ id: 'su-1' }) }

function request(method: string, path: string, init: RequestInit = {}) {
  return new NextRequest(`https://sim.test${path}`, { method, ...init })
}

afterEach(resetEnvFlagsMock)

describe('SCIM route builder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setEnvFlags({ isScimEnabled: true })
    authenticate.mockResolvedValue(principal)
    mocks.checkRateLimitDirect.mockResolvedValue({ allowed: true, resetAt: new Date() })
    mocks.enforceIpRateLimit.mockResolvedValue(null)
  })

  it('hides the whole surface, wrong method included, when the feature is off', async () => {
    setEnvFlags({ isScimEnabled: false })
    const response = await listUsers(request('POST', '/api/scim/v2/Users'), undefined)
    expect(response.status).toBe(404)
    expect(authenticate).not.toHaveBeenCalled()
  })

  it('answers in the SCIM media type with the RFC envelope', async () => {
    const response = await listUsers(request('GET', '/api/scim/v2/Users'), undefined)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(`${SCIM_MEDIA_TYPE}; charset=utf-8`)
    expect(recordRequest).toHaveBeenCalledWith(expect.objectContaining({ status: 200, principal }))
  })

  it('refuses a body without a SCIM or JSON content type before authenticating', async () => {
    const response = await createUser(
      request('POST', '/api/scim/v2/Users', {
        body: '{}',
        headers: { 'content-type': 'text/plain' },
      }),
      undefined
    )
    expect(response.status).toBe(415)
    expect(authenticate).not.toHaveBeenCalled()
  })

  it('lets DELETE through with no body and no content type, answering 204', async () => {
    const response = await deleteUser(request('DELETE', '/api/scim/v2/Users/su-1'), withParams)
    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
  })

  it('adds the Location header on a create', async () => {
    const response = await createUser(
      request('POST', '/api/scim/v2/Users', {
        body: JSON.stringify({
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
          userName: 'ada@acme.test',
        }),
        headers: { 'content-type': SCIM_MEDIA_TYPE },
      }),
      undefined
    )
    expect(response.status).toBe(201)
    expect(response.headers.get('location')).toBe('https://sim.test/api/scim/v2/Users/su-1')
  })

  it('renders a parse failure in the SCIM envelope', async () => {
    const response = await createUser(
      request('POST', '/api/scim/v2/Users', {
        body: '{not json',
        headers: { 'content-type': 'application/json' },
      }),
      undefined
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
      status: '400',
      scimType: 'invalidSyntax',
      detail: 'Request body is not valid JSON',
    })
  })

  it('bounds failed authentication per address and renders 401 with the challenge', async () => {
    authenticate.mockRejectedValue(
      new ScimError(401, undefined, 'Invalid SCIM token', {
        'WWW-Authenticate': 'Bearer realm="SCIM"',
      })
    )
    const refused = await listUsers(request('GET', '/api/scim/v2/Users'), undefined)
    expect(refused.status).toBe(401)
    expect(refused.headers.get('www-authenticate')).toBe('Bearer realm="SCIM"')
    expect(mocks.enforceIpRateLimit).toHaveBeenCalledWith('scim-auth', expect.anything())
    expect(recordRequest).not.toHaveBeenCalled()

    mocks.enforceIpRateLimit.mockResolvedValue(new Response(null, { status: 429 }))
    const limited = await listUsers(request('GET', '/api/scim/v2/Users'), undefined)
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBe('60')
  })

  it('throttles an authenticated connection with Retry-After', async () => {
    mocks.checkRateLimitDirect.mockResolvedValue({
      allowed: false,
      resetAt: new Date(Date.now() + 5000),
    })
    const response = await listUsers(request('GET', '/api/scim/v2/Users'), undefined)
    expect(response.status).toBe(429)
    expect(Number(response.headers.get('retry-after'))).toBeGreaterThanOrEqual(1)
    expect(recordRequest).toHaveBeenCalledWith(expect.objectContaining({ status: 429 }))
  })
})
