/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockIsFeatureEnabled, mockListOrg, mockDeriveEntry } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockIsFeatureEnabled: vi.fn(),
  mockListOrg: vi.fn(),
  mockDeriveEntry: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
  getSession: mockGetSession,
}))
vi.mock('@/lib/core/config/feature-flags', () => ({ isFeatureEnabled: mockIsFeatureEnabled }))
vi.mock('@/lib/workflows/api-reference', () => ({
  listOrgReadableResources: mockListOrg,
  deriveApiReferenceEntry: mockDeriveEntry,
}))

import { GET } from '@/app/api/organizations/[id]/api-resources/route'

function call(orgId = 'org-1') {
  const request = createMockRequest(
    'GET',
    undefined,
    {},
    `http://localhost/api/organizations/${orgId}/api-resources`
  )
  return GET(request, { params: Promise.resolve({ id: orgId }) })
}

describe('GET org api-resources catalog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsFeatureEnabled.mockResolvedValue(true)
    mockGetSession.mockResolvedValue({ user: { id: 'reader-1' } })
    mockDeriveEntry.mockImplementation(async (wf: { id: string; name: string }) => ({
      workflowId: wf.id,
      name: wf.name,
    }))
  })

  it('groups readable resources by workspace-as-service', async () => {
    mockListOrg.mockResolvedValue([
      {
        workflowRow: { id: 'wf-a', name: 'Ask Biz' },
        publication: {},
        workspaceId: 'ws-1',
        workspaceName: 'Biz',
      },
      {
        workflowRow: { id: 'wf-b', name: 'ITSM' },
        publication: {},
        workspaceId: 'ws-2',
        workspaceName: 'IT',
      },
      {
        workflowRow: { id: 'wf-c', name: 'Ask RVT' },
        publication: {},
        workspaceId: 'ws-1',
        workspaceName: 'Biz',
      },
    ])
    const res = await call()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.services).toHaveLength(2)
    const biz = body.services.find((s: { workspaceId: string }) => s.workspaceId === 'ws-1')
    expect(biz.resources.map((r: { workflowId: string }) => r.workflowId).sort()).toEqual([
      'wf-a',
      'wf-c',
    ])
    expect(biz.resources[0].resourceType).toBe('workflow')
  })

  it('404 when the caller is not a member of the org', async () => {
    mockListOrg.mockResolvedValue(null)
    const res = await call()
    expect(res.status).toBe(404)
  })

  it('returns an empty catalog (200) for an org member with nothing published', async () => {
    mockListOrg.mockResolvedValue([])
    const res = await call()
    expect(res.status).toBe(200)
    expect((await res.json()).services).toEqual([])
  })

  it('404 when the feature flag is off', async () => {
    mockIsFeatureEnabled.mockResolvedValue(false)
    const res = await call()
    expect(res.status).toBe(404)
  })

  it('401 when unauthenticated', async () => {
    mockGetSession.mockResolvedValue(null)
    const res = await call()
    expect(res.status).toBe(401)
  })
})
