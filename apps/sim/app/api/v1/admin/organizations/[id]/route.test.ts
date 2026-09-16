/**
 * @vitest-environment node
 */
import { recordAudit, recordAuditBatch } from '@sim/audit'
import {
  createMockRequest,
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockDetachOrganizationWorkspacesTx,
  mockEnqueueResourceCleanup,
  mockAuthenticateAdminRequest,
} = vi.hoisted(() => ({
  mockDetachOrganizationWorkspacesTx: vi.fn(),
  mockEnqueueResourceCleanup: vi.fn(),
  mockAuthenticateAdminRequest: vi.fn(),
}))

vi.mock('@/lib/workspaces/organization-workspaces', () => ({
  detachOrganizationWorkspacesTx: mockDetachOrganizationWorkspacesTx,
}))

vi.mock('@/lib/organizations/resource-cleanup', () => ({
  enqueueOrganizationResourceCleanup: mockEnqueueResourceCleanup,
}))

vi.mock('@/app/api/v1/admin/auth', () => ({
  authenticateAdminRequest: mockAuthenticateAdminRequest,
}))

vi.mock('@sim/audit', () => ({
  recordAudit: vi.fn(),
  recordAuditBatch: vi.fn(),
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
    mockDetachOrganizationWorkspacesTx.mockResolvedValue({
      detachedWorkspaceIds: ['ws-1', 'ws-2'],
      billedAccountUserId: 'user-1',
      /** Returned rather than written, so the caller can emit them post-commit. */
      auditEntries: [],
    })
    mockEnqueueResourceCleanup.mockResolvedValue(undefined)
  })

  afterAll(resetDbChainMock)

  it('returns 404 when the organization does not exist', async () => {
    queueTableRows(schemaMock.organization, [])

    const response = await DELETE(deleteRequest('acme-inc'), routeContext)

    expect(response.status).toBe(404)
    expect(mockDetachOrganizationWorkspacesTx).not.toHaveBeenCalled()
  })

  it('refuses when confirmSlug does not match the organization slug', async () => {
    queueOrganization('acme-inc')

    const response = await DELETE(deleteRequest('wrong-slug'), routeContext)

    expect(response.status).toBe(400)
    expect(mockDetachOrganizationWorkspacesTx).not.toHaveBeenCalled()
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
    expect(mockDetachOrganizationWorkspacesTx).not.toHaveBeenCalled()
  })

  it('is not blocked by a canceled subscription', async () => {
    queueOrganization()
    /**
     * The status filter runs in SQL, so a canceled row never comes back — an
     * empty result here is what an organization whose subscription already
     * ended looks like. Without that filter the row would block deletion
     * forever even though it bills nobody.
     */
    queueTableRows(schemaMock.subscription, [])
    queueTableRows(schemaMock.member, [{ value: 1 }])

    const response = await DELETE(deleteRequest('acme-inc'), routeContext)

    expect(response.status).toBe(200)
    expect(mockDetachOrganizationWorkspacesTx).toHaveBeenCalledWith(expect.anything(), ORG_ID)
  })

  it('detaches workspaces and enqueues resource cleanup before deleting in the same transaction', async () => {
    queueOrganization()
    queueTableRows(schemaMock.subscription, [])
    queueTableRows(schemaMock.member, [{ value: 3 }])

    const response = await DELETE(deleteRequest('acme-inc'), routeContext)

    expect(response.status).toBe(200)
    /**
     * The `ON DELETE SET NULL` foreign key alone would leave workspaces in
     * `organization` mode with a null org id and drop the organization's
     * storage ledger without crediting the new payer. The transaction is passed
     * through so the detach and the delete commit together.
     */
    expect(mockDetachOrganizationWorkspacesTx).toHaveBeenCalledWith(expect.anything(), ORG_ID)
    const tx = mockDetachOrganizationWorkspacesTx.mock.calls[0][0]
    expect(mockEnqueueResourceCleanup).toHaveBeenCalledExactlyOnceWith(tx, ORG_ID)
    expect(mockDetachOrganizationWorkspacesTx.mock.invocationCallOrder[0]).toBeLessThan(
      mockEnqueueResourceCleanup.mock.invocationCallOrder[0]
    )
    expect(mockEnqueueResourceCleanup.mock.invocationCallOrder[0]).toBeLessThan(
      dbChainMockFns.delete.mock.invocationCallOrder[0]
    )
    expect(dbChainMockFns.transaction).toHaveBeenCalledTimes(1)

    const body = await response.json()
    expect(body.data).toMatchObject({
      success: true,
      organizationId: ORG_ID,
      slug: 'acme-inc',
      membersRemoved: 3,
      workspacesDetached: 2,
    })
  })

  it('aborts the transaction before cascade and audit when durable cleanup cannot be queued', async () => {
    queueOrganization()
    queueTableRows(schemaMock.subscription, [])
    queueTableRows(schemaMock.member, [{ value: 3 }])
    mockEnqueueResourceCleanup.mockRejectedValueOnce(new Error('outbox unavailable'))

    const response = await DELETE(deleteRequest('acme-inc'), routeContext)

    expect(response.status).toBe(500)
    expect(mockDetachOrganizationWorkspacesTx).toHaveBeenCalledTimes(1)
    expect(mockEnqueueResourceCleanup).toHaveBeenCalledExactlyOnceWith(
      mockDetachOrganizationWorkspacesTx.mock.calls[0][0],
      ORG_ID
    )
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
    expect(recordAudit).not.toHaveBeenCalled()
    expect(recordAuditBatch).not.toHaveBeenCalled()
  })

  it('does not emit success audit after a cascade failure', async () => {
    queueOrganization()
    queueTableRows(schemaMock.subscription, [])
    queueTableRows(schemaMock.member, [{ value: 3 }])
    dbChainMockFns.delete.mockImplementationOnce(() => {
      throw new Error('cascade unavailable')
    })

    const response = await DELETE(deleteRequest('acme-inc'), routeContext)

    expect(response.status).toBe(500)
    expect(mockEnqueueResourceCleanup).toHaveBeenCalledTimes(1)
    expect(recordAudit).not.toHaveBeenCalled()
    expect(recordAuditBatch).not.toHaveBeenCalled()
  })
})
