import {
  authMockFns,
  createMockRequest,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { createRouteContext } from '@sim/testing/helpers/http'
import { permissionsMock, permissionsMockFns } from '@sim/testing/mocks/permissions.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  createMockWorkspaceApplicationContext,
  workspaceContextMock,
  workspaceContextMockFns,
} from '@sim/testing/mocks/workspace-context.mock'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetApiKeyDisplayFormat = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api-key/auth', () => ({
  getApiKeyDisplayFormat: mockGetApiKeyDisplayFormat,
}))

vi.mock('@/lib/api-key/orchestration', () => ({
  performCreateWorkspaceApiKey: vi.fn(),
}))

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

vi.mock('@/lib/workspaces/application/workspace-context', () => workspaceContextMock)
vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

import { GET } from '@/app/api/workspaces/[id]/api-keys/route'

const mockGetSession = authMockFns.mockGetSession
const { mockGetUserEntityPermissions, mockGetWorkspaceById } = permissionsMockFns
workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockImplementation(
  (...args: unknown[]) => mockGetUserEntityPermissions(...args)
)
workspaceContextMockFns.mockLoadActiveWorkspaceApplicationContext.mockImplementation(
  async (workspaceId: string) =>
    createMockWorkspaceApplicationContext({
      workspaceId,
      workspaceOrganizationId: 'org',
      billedAccountUserId: 'billing',
    })
)

describe('GET /api/workspaces/[id]/api-keys', () => {
  beforeEach(() => {
    resetDbChainMock()
    mockGetSession.mockResolvedValue({ user: { id: 'reader-1' }, session: { id: 'session' } })
    mockGetWorkspaceById.mockResolvedValue({ id: 'workspace-1' })
    mockGetUserEntityPermissions.mockResolvedValue('read')
    mockGetApiKeyDisplayFormat.mockResolvedValue('sim_••••legacy')
    queueTableRows(schemaMock.apiKey, [
      {
        id: 'key-1',
        name: 'Legacy key',
        key: 'sim_plaintext_legacy_secret',
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
        lastUsed: null,
        expiresAt: null,
        createdBy: 'owner-1',
      },
    ])
  })

  afterAll(() => {
    resetDbChainMock()
  })

  it('returns metadata without exposing the stored key value', async () => {
    const response = await GET(createMockRequest('GET'), createRouteContext({ id: 'workspace-1' }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.keys).toEqual([
      {
        id: 'key-1',
        name: 'Legacy key',
        displayKey: 'sim_••••legacy',
        createdAt: '2026-07-01T00:00:00.000Z',
        lastUsed: null,
        expiresAt: null,
        createdBy: 'owner-1',
      },
    ])
    expect(body.keys[0]).not.toHaveProperty('key')
    expect(mockGetApiKeyDisplayFormat).toHaveBeenCalledWith('sim_plaintext_legacy_secret')
  })
})
