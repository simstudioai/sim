/**
 * @vitest-environment node
 */
import {
  createMockRequest,
  dbChainMock,
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationError } from '@/lib/core/orchestration/types'

const { mockGetSession, mockSetPrimary } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockSetPrimary: vi.fn(),
}))

vi.mock('@sim/db', () => ({ ...dbChainMock, ...schemaMock }))
vi.mock('@/lib/auth', () => ({ getSession: mockGetSession }))
/** Authorization and the primary switch are the use case's; its own tests and the PostgreSQL suite cover them. */
vi.mock('@/lib/auth/sso/application/set-primary-provider', () => ({
  setPrimarySsoProviderOperation: { id: 'organization.sso.set_primary_provider' },
  setPrimarySsoProvider: {
    operation: { id: 'organization.sso.set_primary_provider' },
    execute: mockSetPrimary,
  },
}))

import { DELETE, PATCH } from '@/app/api/auth/sso/providers/[providerId]/route'

const context = { params: Promise.resolve({ providerId: 'acme-okta' }) }
const request = () => createMockRequest('DELETE')

describe('DELETE /api/auth/sso/providers/[providerId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockGetSession.mockResolvedValue({ user: { id: 'u1' } })
    dbChainMockFns.returning.mockResolvedValue([{ id: 'row-1' }])
  })

  it('clears the name of a domain that made the deleted provider primary', async () => {
    queueTableRows(schemaMock.ssoProvider, [
      { id: 'row-1', organizationId: 'org1', userId: 'u1', domain: 'acme.com' },
    ])
    queueTableRows(schemaMock.member, [{ role: 'owner' }])
    const res = await DELETE(request(), context)
    expect(res.status).toBe(200)
    expect(dbChainMockFns.transaction).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.update).toHaveBeenCalledWith(schemaMock.ssoDomain)
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ primaryProviderId: null })
    )
  })

  it('leaves domains alone when deleting a personal provider', async () => {
    queueTableRows(schemaMock.ssoProvider, [
      { id: 'row-1', organizationId: null, userId: 'u1', domain: 'acme.com' },
    ])
    const res = await DELETE(request(), context)
    expect(res.status).toBe(200)
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('leaves domains alone when nothing was deleted', async () => {
    queueTableRows(schemaMock.ssoProvider, [
      { id: 'row-1', organizationId: 'org1', userId: 'u1', domain: 'acme.com' },
    ])
    queueTableRows(schemaMock.member, [{ role: 'owner' }])
    dbChainMockFns.returning.mockResolvedValue([])
    expect((await DELETE(request(), context)).status).toBe(404)
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('requires a session', async () => {
    mockGetSession.mockResolvedValue(null)
    const res = await DELETE(request(), context)
    expect(res.status).toBe(401)
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
  })

  it('answers 404 for an unknown provider', async () => {
    queueTableRows(schemaMock.ssoProvider, [])
    const res = await DELETE(request(), context)
    expect(res.status).toBe(404)
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
  })

  it("refuses an organization provider to a member who is not the organization's admin", async () => {
    queueTableRows(schemaMock.ssoProvider, [
      { id: 'row-1', organizationId: 'org1', userId: 'u-other', domain: 'acme.com' },
    ])
    queueTableRows(schemaMock.member, [{ role: 'member' }])
    const res = await DELETE(request(), context)
    expect(res.status).toBe(403)
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
  })

  it('lets an organization admin delete a provider another admin created', async () => {
    queueTableRows(schemaMock.ssoProvider, [
      { id: 'row-1', organizationId: 'org1', userId: 'u-other', domain: 'acme.com' },
    ])
    queueTableRows(schemaMock.member, [{ role: 'admin' }])
    const res = await DELETE(request(), context)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ success: true, providerId: 'acme-okta' })
    expect(dbChainMockFns.delete).toHaveBeenCalledWith(schemaMock.ssoProvider)
  })

  it('lets only the creator delete a personal provider', async () => {
    queueTableRows(schemaMock.ssoProvider, [
      { id: 'row-1', organizationId: null, userId: 'u-other', domain: 'acme.com' },
    ])
    const refused = await DELETE(request(), context)
    expect(refused.status).toBe(403)

    resetDbChainMock()
    dbChainMockFns.returning.mockResolvedValue([{ id: 'row-1' }])
    queueTableRows(schemaMock.ssoProvider, [
      { id: 'row-1', organizationId: null, userId: 'u1', domain: 'acme.com' },
    ])
    const allowed = await DELETE(request(), context)
    expect(allowed.status).toBe(200)
  })

  it.each([129, 256])('deletes a provider with a %i-character ID', async (length) => {
    const providerId = 'a'.repeat(length)
    queueTableRows(schemaMock.ssoProvider, [
      { id: 'row-1', organizationId: 'org1', userId: 'u1', domain: 'acme.com' },
    ])
    queueTableRows(schemaMock.member, [{ role: 'owner' }])

    const res = await DELETE(request(), { params: Promise.resolve({ providerId }) })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ success: true, providerId })
    expect(dbChainMockFns.delete).toHaveBeenCalledWith(schemaMock.ssoProvider)
  })
})

describe('PATCH /api/auth/sso/providers/[providerId]', () => {
  const patch = (body: Record<string, unknown> = { isPrimary: true }) =>
    PATCH(createMockRequest('PATCH', body), context)

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'u1' }, session: { id: 's1' } })
    mockSetPrimary.mockResolvedValue({
      providerId: 'acme-okta',
      organizationId: 'org1',
      domain: 'acme.com',
    })
  })

  it('requires a session before the use case runs', async () => {
    mockGetSession.mockResolvedValue(null)
    expect((await patch()).status).toBe(401)
    expect(mockSetPrimary).not.toHaveBeenCalled()
  })

  it('only accepts making a provider primary', async () => {
    expect((await patch({ isPrimary: false })).status).toBe(400)
    expect(mockSetPrimary).not.toHaveBeenCalled()
  })

  it('passes the routed provider to the use case and presents its result', async () => {
    const res = await patch()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ success: true, providerId: 'acme-okta' })
    expect(mockSetPrimary).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: expect.objectContaining({ kind: 'session', userId: 'u1' }),
        input: { providerId: 'acme-okta' },
      })
    )
  })

  it.each([
    ['conflict', 409, 'Verify acme.com before making this provider primary.'],
    ['forbidden', 403, 'Organization administrator access is required'],
    ['not_found', 404, 'Provider not found'],
  ] as const)('projects a %s refusal with its message', async (code, status, message) => {
    mockSetPrimary.mockRejectedValue(new OrchestrationError(code, message))
    const res = await patch()
    expect(res.status).toBe(status)
    await expect(res.json()).resolves.toEqual({ error: message })
  })
})
