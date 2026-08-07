/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckRateLimit,
  mockResolveWorkspaceAccess,
  mockCheckWorkspaceAccess,
  mockListVisibleWorkspaceCredentials,
} = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockResolveWorkspaceAccess: vi.fn(),
  mockCheckWorkspaceAccess: vi.fn(),
  mockListVisibleWorkspaceCredentials: vi.fn(),
}))

vi.mock('@/app/api/v1/middleware', () => ({
  checkRateLimit: mockCheckRateLimit,
  resolveWorkspaceAccess: mockResolveWorkspaceAccess,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  checkWorkspaceAccess: mockCheckWorkspaceAccess,
}))

vi.mock('@/lib/credentials/queries', () => ({
  listVisibleWorkspaceCredentials: mockListVisibleWorkspaceCredentials,
}))

vi.mock('@/app/api/v2/lib/gate', () => ({
  v2ApiGateError: vi.fn().mockResolvedValue(null),
}))

import { GET } from '@/app/api/v2/secrets/route'

const WORKSPACE_ID = '11111111-2222-4333-8444-555555555555'
const RATE_LIMIT_OK = {
  allowed: true,
  userId: 'user-1',
  keyType: 'workspace',
  limit: 100,
  remaining: 99,
  resetAt: new Date('2024-01-01T01:00:00Z'),
}

function secretCredential(overrides: Record<string, unknown> = {}) {
  return {
    id: 'secret-1',
    workspaceId: WORKSPACE_ID,
    type: 'env_workspace' as const,
    displayName: 'STRIPE_API_KEY',
    description: null,
    providerId: null,
    accountId: null,
    envKey: 'STRIPE_API_KEY',
    envOwnerUserId: null,
    createdBy: 'user-1',
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-02T00:00:00Z'),
    hasServiceAccountKey: false,
    role: 'admin' as const,
    ...overrides,
  }
}

const callList = (query: string) =>
  GET(new NextRequest(`http://localhost:3000/api/v2/secrets?${query}`))

describe('GET /api/v2/secrets', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockResolveWorkspaceAccess.mockResolvedValue(null)
    mockCheckWorkspaceAccess.mockResolvedValue({ hasAccess: true, canWrite: true, canAdmin: true })
    mockListVisibleWorkspaceCredentials.mockResolvedValue([secretCredential()])
  })

  it('lists metadata without a value field', async () => {
    const res = await callList(`workspaceId=${WORKSPACE_ID}`)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({
      data: [
        {
          name: 'STRIPE_API_KEY',
          scope: 'workspace',
          role: 'admin',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-02T00:00:00.000Z',
        },
      ],
      nextCursor: null,
    })
    expect(JSON.stringify(body)).not.toContain('value')
    expect(mockListVisibleWorkspaceCredentials).toHaveBeenCalledWith(
      expect.objectContaining({ types: ['env_workspace'] })
    )
  })

  it('does not expose another user personal secret', async () => {
    mockListVisibleWorkspaceCredentials.mockResolvedValue([
      secretCredential({
        id: 'secret-2',
        type: 'env_personal',
        displayName: 'PRIVATE_KEY',
        envKey: 'PRIVATE_KEY',
        envOwnerUserId: 'user-2',
      }),
    ])

    const res = await callList(`workspaceId=${WORKSPACE_ID}`)

    expect((await res.json()).data).toEqual([])
  })

  it('requires a personal key when personal scope is explicit', async () => {
    const res = await callList(`workspaceId=${WORKSPACE_ID}&scope=personal`)

    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('PERSONAL_KEY_REQUIRED')
    expect(mockListVisibleWorkspaceCredentials).not.toHaveBeenCalled()
  })

  it('maps scope and sort filters to the credential catalog', async () => {
    await callList(
      `workspaceId=${WORKSPACE_ID}&scope=workspace&search=STRIPE&sortBy=name&sortOrder=desc`
    )

    expect(mockListVisibleWorkspaceCredentials).toHaveBeenCalledWith(
      expect.objectContaining({
        types: ['env_workspace'],
        search: 'STRIPE',
        sortBy: 'displayName',
        sortOrder: 'desc',
      })
    )
  })

  it('rejects missing workspace context', async () => {
    const res = await callList('')

    expect(res.status).toBe(400)
    expect(mockListVisibleWorkspaceCredentials).not.toHaveBeenCalled()
  })
})
