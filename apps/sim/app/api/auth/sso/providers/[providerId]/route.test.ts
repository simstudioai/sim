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

const { mockGetSession } = vi.hoisted(() => ({ mockGetSession: vi.fn() }))

vi.mock('@sim/db', () => ({ ...dbChainMock, ...schemaMock }))
vi.mock('@/lib/auth', () => ({ getSession: mockGetSession }))

import { DELETE } from '@/app/api/auth/sso/providers/[providerId]/route'

const context = { params: Promise.resolve({ providerId: 'acme-okta' }) }
const request = () => createMockRequest('DELETE')

describe('DELETE /api/auth/sso/providers/[providerId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockGetSession.mockResolvedValue({ user: { id: 'u1' } })
    dbChainMockFns.returning.mockResolvedValue([{ id: 'row-1' }])
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

  it('answers 404 when the row vanished between the check and the delete', async () => {
    queueTableRows(schemaMock.ssoProvider, [
      { id: 'row-1', organizationId: 'org1', userId: 'u1', domain: 'acme.com' },
    ])
    queueTableRows(schemaMock.member, [{ role: 'owner' }])
    dbChainMockFns.returning.mockResolvedValue([])
    const res = await DELETE(request(), context)
    expect(res.status).toBe(404)
  })
})
