/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckRateLimit,
  mockResolveWorkspaceAccess,
  mockCheckWorkspaceAccess,
  mockGetWorkspaceEnvKeyAdminAccess,
  mockListVisibleWorkspaceCredentials,
  mockSetWorkspaceSecret,
  mockSetPersonalSecret,
  mockDeleteWorkspaceSecret,
  mockDeletePersonalSecret,
  mockRecordAudit,
} = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockResolveWorkspaceAccess: vi.fn(),
  mockCheckWorkspaceAccess: vi.fn(),
  mockGetWorkspaceEnvKeyAdminAccess: vi.fn(),
  mockListVisibleWorkspaceCredentials: vi.fn(),
  mockSetWorkspaceSecret: vi.fn(),
  mockSetPersonalSecret: vi.fn(),
  mockDeleteWorkspaceSecret: vi.fn(),
  mockDeletePersonalSecret: vi.fn(),
  mockRecordAudit: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: {
    ENVIRONMENT_UPDATED: 'environment.updated',
    ENVIRONMENT_DELETED: 'environment.deleted',
  },
  AuditResourceType: { ENVIRONMENT: 'environment' },
  recordAudit: mockRecordAudit,
}))

vi.mock('@/app/api/v1/middleware', () => ({
  checkRateLimit: mockCheckRateLimit,
  resolveWorkspaceAccess: mockResolveWorkspaceAccess,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  checkWorkspaceAccess: mockCheckWorkspaceAccess,
}))

vi.mock('@/lib/credentials/environment', () => ({
  getWorkspaceEnvKeyAdminAccess: mockGetWorkspaceEnvKeyAdminAccess,
}))

vi.mock('@/lib/credentials/queries', () => ({
  listVisibleWorkspaceCredentials: mockListVisibleWorkspaceCredentials,
}))

vi.mock('@/lib/credentials/secret-values', () => ({
  setWorkspaceSecret: mockSetWorkspaceSecret,
  setPersonalSecret: mockSetPersonalSecret,
  deleteWorkspaceSecret: mockDeleteWorkspaceSecret,
  deletePersonalSecret: mockDeletePersonalSecret,
}))

vi.mock('@/app/api/v2/lib/gate', () => ({
  v2ApiGateError: vi.fn().mockResolvedValue(null),
}))

import { DELETE, PUT } from '@/app/api/v2/secrets/[name]/route'

const WORKSPACE_ID = '11111111-2222-4333-8444-555555555555'
const RATE_LIMIT_OK = {
  allowed: true,
  userId: 'user-1',
  keyType: 'workspace',
  limit: 100,
  remaining: 99,
  resetAt: new Date('2024-01-01T01:00:00Z'),
}

function secretCredential(scope: 'workspace' | 'personal') {
  return {
    id: 'secret-1',
    workspaceId: WORKSPACE_ID,
    type: scope === 'workspace' ? ('env_workspace' as const) : ('env_personal' as const),
    displayName: 'STRIPE_API_KEY',
    description: null,
    providerId: null,
    accountId: null,
    envKey: 'STRIPE_API_KEY',
    envOwnerUserId: scope === 'personal' ? 'user-1' : null,
    createdBy: 'user-1',
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-02T00:00:00Z'),
    hasServiceAccountKey: false,
    role: 'admin' as const,
  }
}

const context = { params: Promise.resolve({ name: 'STRIPE_API_KEY' }) }

function callSet(scope: 'workspace' | 'personal', value = 'super-secret-value') {
  mockListVisibleWorkspaceCredentials.mockResolvedValue([secretCredential(scope)])
  return PUT(
    new NextRequest('http://localhost:3000/api/v2/secrets/STRIPE_API_KEY', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: WORKSPACE_ID, scope, value }),
    }),
    context
  )
}

function callDelete(scope: 'workspace' | 'personal') {
  return DELETE(
    new NextRequest(
      `http://localhost:3000/api/v2/secrets/STRIPE_API_KEY?workspaceId=${WORKSPACE_ID}&scope=${scope}`,
      { method: 'DELETE' }
    ),
    context
  )
}

describe('PUT /api/v2/secrets/[name]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockResolveWorkspaceAccess.mockResolvedValue(null)
    mockCheckWorkspaceAccess.mockResolvedValue({ hasAccess: true, canWrite: true, canAdmin: false })
    mockGetWorkspaceEnvKeyAdminAccess.mockResolvedValue({
      adminKeys: new Set<string>(),
      knownKeys: new Set<string>(),
    })
    mockSetWorkspaceSecret.mockResolvedValue({ created: true, updatedAt: new Date() })
    mockSetPersonalSecret.mockResolvedValue({ created: true, updatedAt: new Date() })
  })

  it('sets a workspace secret and never echoes its value', async () => {
    const res = await callSet('workspace')
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.data.secret).toMatchObject({ name: 'STRIPE_API_KEY', scope: 'workspace' })
    expect(JSON.stringify(body)).not.toContain('super-secret-value')
    expect(mockSetWorkspaceSecret).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      name: 'STRIPE_API_KEY',
      value: 'super-secret-value',
      userId: 'user-1',
    })
  })

  it('updates an existing workspace secret only for a secret admin', async () => {
    mockCheckRateLimit.mockResolvedValue({ ...RATE_LIMIT_OK, keyType: 'personal' })
    mockGetWorkspaceEnvKeyAdminAccess.mockResolvedValue({
      adminKeys: new Set<string>(),
      knownKeys: new Set(['STRIPE_API_KEY']),
    })

    const forbidden = await callSet('workspace')
    expect(forbidden.status).toBe(403)
    expect(mockSetWorkspaceSecret).not.toHaveBeenCalled()

    mockGetWorkspaceEnvKeyAdminAccess.mockResolvedValue({
      adminKeys: new Set(['STRIPE_API_KEY']),
      knownKeys: new Set(['STRIPE_API_KEY']),
    })
    mockSetWorkspaceSecret.mockResolvedValue({ created: false, updatedAt: new Date() })

    const updated = await callSet('workspace')
    expect(updated.status).toBe(200)
  })

  it('sets only the caller-owned personal secret catalog', async () => {
    mockCheckRateLimit.mockResolvedValue({ ...RATE_LIMIT_OK, keyType: 'personal' })
    const res = await callSet('personal')

    expect(res.status).toBe(201)
    expect(mockSetPersonalSecret).toHaveBeenCalledWith({
      userId: 'user-1',
      name: 'STRIPE_API_KEY',
      value: 'super-secret-value',
    })
    expect(mockSetWorkspaceSecret).not.toHaveBeenCalled()
  })

  it('rejects invalid names and empty values before storage', async () => {
    const invalidContext = { params: Promise.resolve({ name: 'not-valid' }) }
    const res = await PUT(
      new NextRequest('http://localhost:3000/api/v2/secrets/not-valid', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: WORKSPACE_ID, scope: 'workspace', value: '' }),
      }),
      invalidContext
    )

    expect(res.status).toBe(400)
    expect(mockSetWorkspaceSecret).not.toHaveBeenCalled()
  })

  it('requires a personal key for personal secrets', async () => {
    const res = await callSet('personal')

    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('PERSONAL_KEY_REQUIRED')
    expect(mockSetPersonalSecret).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/v2/secrets/[name]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockResolveWorkspaceAccess.mockResolvedValue(null)
    mockCheckWorkspaceAccess.mockResolvedValue({ hasAccess: true, canWrite: true, canAdmin: true })
    mockGetWorkspaceEnvKeyAdminAccess.mockResolvedValue({
      adminKeys: new Set(['STRIPE_API_KEY']),
      knownKeys: new Set(['STRIPE_API_KEY']),
    })
    mockDeleteWorkspaceSecret.mockResolvedValue(true)
    mockDeletePersonalSecret.mockResolvedValue(true)
  })

  it('deletes workspace secret metadata without returning a value', async () => {
    const res = await callDelete('workspace')
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data).toEqual({ name: 'STRIPE_API_KEY', scope: 'workspace', deleted: true })
    expect(JSON.stringify(body)).not.toContain('value')
  })

  it('returns 404 when the scoped secret does not exist', async () => {
    mockCheckRateLimit.mockResolvedValue({ ...RATE_LIMIT_OK, keyType: 'personal' })
    mockDeletePersonalSecret.mockResolvedValue(false)

    const res = await callDelete('personal')

    expect(res.status).toBe(404)
  })
})
