/**
 * @vitest-environment node
 */
import { createMockRequest, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDetachOrganizationWorkspaces, mockDelete, mockAuthenticateAdminRequest } = vi.hoisted(
  () => ({
    mockDetachOrganizationWorkspaces: vi.fn(),
    mockDelete: vi.fn(),
    mockAuthenticateAdminRequest: vi.fn(),
  })
)

vi.mock('@/lib/workspaces/organization-workspaces', () => ({
  detachOrganizationWorkspaces: mockDetachOrganizationWorkspaces,
}))

vi.mock('@/app/api/v1/admin/auth', () => ({
  authenticateAdminRequest: mockAuthenticateAdminRequest,
}))

vi.mock('@sim/audit', () => ({
  recordAudit: vi.fn(),
  AuditAction: {
    ORGANIZATION_UPDATED: 'organization.updated',
    ORGANIZATION_DELETED: 'organization.deleted',
  },
  AuditResourceType: { ORGANIZATION: 'organization' },
}))

import { DELETE } from '@/app/api/v1/admin/organizations/[id]/route'

const ORG_ID = 'org-1'
const routeContext = { params: Promise.resolve({ id: ORG_ID }) }

function deleteRequest(confirmSlug?: string) {
  const query = confirmSlug === undefined ? '' : `?confirmSlug=${encodeURIComponent(confirmSlug)}`
  return createMockRequest(
    'DELETE',
    undefined,
    {},
    `http://localhost:3000/api/v1/admin/organizations/${ORG_ID}${query}`
  )
}

/** Queues the organization lookup the handler runs before any guard. */
function queueOrganization(slug = 'acme-inc') {
  queueTableRows(schemaMock.organization, [{ id: ORG_ID, name: 'Acme', slug }])
}

describe('admin organization DELETE', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockAuthenticateAdminRequest.mockReturnValue({ authenticated: true })
    mockDetachOrganizationWorkspaces.mockResolvedValue({
      detachedWorkspaceIds: ['ws-1', 'ws-2'],
      billedAccountUserId: 'user-1',
    })
    mockDelete.mockClear()
  })

  afterAll(resetDbChainMock)

  it('returns 404 when the organization does not exist', async () => {
    queueTableRows(schemaMock.organization, [])

    const response = await DELETE(deleteRequest('acme-inc'), routeContext)

    expect(response.status).toBe(404)
    expect(mockDetachOrganizationWorkspaces).not.toHaveBeenCalled()
  })

  it('refuses when confirmSlug does not match the organization slug', async () => {
    queueOrganization('acme-inc')

    const response = await DELETE(deleteRequest('wrong-slug'), routeContext)

    expect(response.status).toBe(400)
    expect(mockDetachOrganizationWorkspaces).not.toHaveBeenCalled()
  })

  it('refuses with 409 while a subscription still references the organization', async () => {
    queueOrganization()
    queueTableRows(schemaMock.subscription, [{ id: 'sub-1', plan: 'enterprise' }])

    const response = await DELETE(deleteRequest('acme-inc'), routeContext)

    /**
     * `subscription.reference_id` has no foreign key, so deleting here would
     * strand the row and its Stripe billing against a dangling id.
     */
    expect(response.status).toBe(409)
    expect(mockDetachOrganizationWorkspaces).not.toHaveBeenCalled()
  })

  it('detaches workspaces before deleting the organization', async () => {
    queueOrganization()
    queueTableRows(schemaMock.subscription, [])
    queueTableRows(schemaMock.member, [{ value: 3 }])

    const response = await DELETE(deleteRequest('acme-inc'), routeContext)

    expect(response.status).toBe(200)
    /**
     * The `ON DELETE SET NULL` foreign key alone would leave workspaces in
     * `organization` mode with a null org id and drop the organization's
     * storage ledger without crediting the new payer.
     */
    expect(mockDetachOrganizationWorkspaces).toHaveBeenCalledWith(ORG_ID)

    const body = await response.json()
    expect(body.data).toMatchObject({
      success: true,
      organizationId: ORG_ID,
      slug: 'acme-inc',
      membersRemoved: 3,
      workspacesDetached: 2,
    })
  })
})
