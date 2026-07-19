/**
 * @vitest-environment node
 */
import { auditMock, auditMockFns, permissionsMock, permissionsMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { InterfaceDefinition } from '@/lib/interfaces'

const {
  mockGetInterfaceById,
  mockGetShareForResource,
  mockUpsertResourceShare,
  mockValidateInterfaceSharing,
} = vi.hoisted(() => ({
  mockGetInterfaceById: vi.fn(),
  mockGetShareForResource: vi.fn(),
  mockUpsertResourceShare: vi.fn(),
  mockValidateInterfaceSharing: vi.fn(),
}))

vi.mock('@/lib/interfaces', () => {
  class InterfaceConflictError extends Error {
    readonly code = 'INTERFACE_EXISTS' as const
  }
  class InterfaceStaleWriteError extends Error {
    readonly code = 'INTERFACE_STALE_WRITE' as const
  }
  class InterfaceLayoutError extends Error {
    readonly code = 'INVALID_INTERFACE_LAYOUT' as const
    readonly errors: string[]
    constructor(errors: string[]) {
      super(errors.join('; '))
      this.errors = errors
    }
  }
  class InvalidModuleReferenceError extends Error {
    readonly code = 'INVALID_MODULE_REFERENCE' as const
  }
  return {
    getInterfaceById: mockGetInterfaceById,
    InterfaceConflictError,
    InterfaceLayoutError,
    InterfaceStaleWriteError,
    InvalidModuleReferenceError,
  }
})

vi.mock('@/lib/public-shares/share-manager', () => {
  class ShareValidationError extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'ShareValidationError'
    }
  }
  return {
    getShareForResource: mockGetShareForResource,
    upsertResourceShare: mockUpsertResourceShare,
    ShareValidationError,
  }
})

vi.mock('@/ee/access-control/utils/permission-check', () => {
  class PublicInterfaceSharingNotAllowedError extends Error {
    constructor() {
      super('Public interface sharing is not allowed based on your permission group settings')
      this.name = 'PublicInterfaceSharingNotAllowedError'
    }
  }
  return {
    validatePublicInterfaceSharing: mockValidateInterfaceSharing,
    PublicInterfaceSharingNotAllowedError,
  }
})

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@sim/audit', () => auditMock)

import { authMockFns } from '@sim/testing'
import { ShareValidationError } from '@/lib/public-shares/share-manager'
import { GET, PUT } from '@/app/api/interfaces/[interfaceId]/share/route'

const WS = 'ws-1'
const OTHER_WS = 'ws-2'
const INTERFACE_ID = 'int-1'

const params = (interfaceId = INTERFACE_ID) => ({ params: Promise.resolve({ interfaceId }) })

const getRequest = (workspaceId: string = WS) =>
  new NextRequest(
    `http://localhost/api/interfaces/${INTERFACE_ID}/share?workspaceId=${workspaceId}`
  )

const putRequest = (body: unknown) =>
  new NextRequest(`http://localhost/api/interfaces/${INTERFACE_ID}/share`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

function buildDefinition(overrides: Partial<InterfaceDefinition> = {}): InterfaceDefinition {
  return {
    id: INTERFACE_ID,
    workspaceId: WS,
    name: 'Support desk',
    description: null,
    layout: { version: 1, grid: { rows: 2, cols: 2 }, modules: [] },
    createdBy: 'user-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    archivedAt: null,
    ...overrides,
  }
}

const SHARE = {
  id: 'sh_1',
  token: 'tok_1',
  url: 'https://sim.ai/i/tok_1',
  isActive: true,
  resourceType: 'interface' as const,
  resourceId: INTERFACE_ID,
  authType: 'public' as const,
  hasPassword: false,
  allowedEmails: [],
}

describe('interface share route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'user-1', name: 'User One', email: 'u@example.com' },
    })
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('write')
    mockGetInterfaceById.mockResolvedValue(buildDefinition())
    mockGetShareForResource.mockResolvedValue(SHARE)
    mockUpsertResourceShare.mockResolvedValue(SHARE)
    mockValidateInterfaceSharing.mockResolvedValue(undefined)
  })

  describe('GET', () => {
    it('returns 401 when unauthenticated', async () => {
      authMockFns.mockGetSession.mockResolvedValueOnce(null)
      const res = await GET(getRequest(), params())
      expect(res.status).toBe(401)
      expect(mockGetShareForResource).not.toHaveBeenCalled()
    })

    it('returns 403 when the caller has no workspace permission', async () => {
      permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValueOnce(null)
      const res = await GET(getRequest(), params())
      expect(res.status).toBe(403)
      expect(mockGetShareForResource).not.toHaveBeenCalled()
    })

    it('returns the share for a read-only member', async () => {
      permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValueOnce('read')
      const res = await GET(getRequest(), params())
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ share: SHARE })
      expect(mockGetShareForResource).toHaveBeenCalledWith('interface', INTERFACE_ID)
    })

    it('returns null when no share row exists', async () => {
      mockGetShareForResource.mockResolvedValueOnce(null)
      const res = await GET(getRequest(), params())
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ share: null })
    })

    it('returns 404 when the interface does not exist', async () => {
      mockGetInterfaceById.mockResolvedValueOnce(null)
      const res = await GET(getRequest(), params())
      expect(res.status).toBe(404)
      expect(mockGetShareForResource).not.toHaveBeenCalled()
    })

    /**
     * `getInterfaceById` is not workspace-scoped, so a member of workspace B
     * must not be able to read workspace A's share by naming their own
     * workspace in the query.
     */
    it('returns 404 when the interface belongs to another workspace', async () => {
      mockGetInterfaceById.mockResolvedValueOnce(buildDefinition({ workspaceId: OTHER_WS }))
      const res = await GET(getRequest(WS), params())
      expect(res.status).toBe(404)
      expect(permissionsMockFns.mockGetUserEntityPermissions).not.toHaveBeenCalled()
      expect(mockGetShareForResource).not.toHaveBeenCalled()
    })

    it('rejects a request with no workspaceId', async () => {
      const res = await GET(
        new NextRequest(`http://localhost/api/interfaces/${INTERFACE_ID}/share`),
        params()
      )
      expect(res.status).toBe(400)
    })
  })

  describe('PUT', () => {
    it('returns 401 when unauthenticated', async () => {
      authMockFns.mockGetSession.mockResolvedValueOnce(null)
      const res = await PUT(putRequest({ workspaceId: WS, isActive: true }), params())
      expect(res.status).toBe(401)
      expect(mockUpsertResourceShare).not.toHaveBeenCalled()
    })

    it('returns 403 for a read-only member', async () => {
      permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValueOnce('read')
      const res = await PUT(putRequest({ workspaceId: WS, isActive: true }), params())
      expect(res.status).toBe(403)
      expect(mockUpsertResourceShare).not.toHaveBeenCalled()
    })

    it('returns 404 when the interface belongs to another workspace', async () => {
      mockGetInterfaceById.mockResolvedValueOnce(buildDefinition({ workspaceId: OTHER_WS }))
      const res = await PUT(putRequest({ workspaceId: WS, isActive: true }), params())
      expect(res.status).toBe(404)
      expect(mockUpsertResourceShare).not.toHaveBeenCalled()
    })

    it('enables a public share for a writer', async () => {
      const res = await PUT(putRequest({ workspaceId: WS, isActive: true }), params())
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ share: SHARE })
      expect(mockUpsertResourceShare).toHaveBeenCalledWith({
        resourceType: 'interface',
        resourceId: INTERFACE_ID,
        workspaceId: WS,
        userId: 'user-1',
        isActive: true,
        authType: undefined,
        password: undefined,
        allowedEmails: undefined,
        token: undefined,
      })
    })

    /**
     * The record's own workspace — proven equal to the client's by
     * `resolveInterfaceAccess` — is what reaches the writer, never the raw body
     * value.
     */
    it('persists the record workspace, not the client-supplied one', async () => {
      mockGetInterfaceById.mockResolvedValueOnce(buildDefinition({ workspaceId: WS }))
      await PUT(putRequest({ workspaceId: WS, isActive: true }), params())
      expect(mockUpsertResourceShare).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceId: WS })
      )
      expect(mockValidateInterfaceSharing).toHaveBeenCalledWith('user-1', WS, 'public')
    })

    it('forwards the password auth mode to the policy gate and the writer', async () => {
      const res = await PUT(
        putRequest({ workspaceId: WS, isActive: true, authType: 'password', password: 'hunter22' }),
        params()
      )
      expect(res.status).toBe(200)
      expect(mockValidateInterfaceSharing).toHaveBeenCalledWith('user-1', WS, 'password')
      expect(mockUpsertResourceShare).toHaveBeenCalledWith(
        expect.objectContaining({ authType: 'password', password: 'hunter22' })
      )
    })

    it('returns 403 when org policy disallows enabling', async () => {
      const { PublicInterfaceSharingNotAllowedError } = await import(
        '@/ee/access-control/utils/permission-check'
      )
      mockValidateInterfaceSharing.mockRejectedValueOnce(
        new PublicInterfaceSharingNotAllowedError()
      )
      const res = await PUT(putRequest({ workspaceId: WS, isActive: true }), params())
      expect(res.status).toBe(403)
      expect(mockUpsertResourceShare).not.toHaveBeenCalled()
    })

    it('allows disabling even when org policy disallows enabling', async () => {
      mockValidateInterfaceSharing.mockRejectedValue(new Error('should not be called for disable'))
      const res = await PUT(putRequest({ workspaceId: WS, isActive: false }), params())
      expect(res.status).toBe(200)
      expect(mockValidateInterfaceSharing).not.toHaveBeenCalled()
      expect(mockUpsertResourceShare).toHaveBeenCalledWith(
        expect.objectContaining({ isActive: false })
      )
    })

    it('maps a ShareValidationError to 400, not 500', async () => {
      mockUpsertResourceShare.mockRejectedValueOnce(
        new ShareValidationError('Password is required for password-protected shares')
      )
      const res = await PUT(
        putRequest({ workspaceId: WS, isActive: true, authType: 'password' }),
        params()
      )
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('Password is required for password-protected shares')
    })

    it('records an audit entry with the enable action', async () => {
      await PUT(putRequest({ workspaceId: WS, isActive: true }), params())
      expect(auditMockFns.mockRecordAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: WS,
          actorId: 'user-1',
          action: 'interface.shared',
          resourceType: 'interface',
          resourceId: INTERFACE_ID,
          resourceName: 'Support desk',
        })
      )
    })

    it('records an audit entry with the disable action', async () => {
      await PUT(putRequest({ workspaceId: WS, isActive: false }), params())
      expect(auditMockFns.mockRecordAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'interface.share_disabled' })
      )
    })

    it('rejects a body with no isActive', async () => {
      const res = await PUT(putRequest({ workspaceId: WS }), params())
      expect(res.status).toBe(400)
      expect(mockUpsertResourceShare).not.toHaveBeenCalled()
    })

    it('rejects a body with no workspaceId', async () => {
      const res = await PUT(putRequest({ isActive: true }), params())
      expect(res.status).toBe(400)
      expect(mockUpsertResourceShare).not.toHaveBeenCalled()
    })

    it('rejects a malformed pre-reserved token', async () => {
      const res = await PUT(
        putRequest({ workspaceId: WS, isActive: true, token: 'short' }),
        params()
      )
      expect(res.status).toBe(400)
      expect(mockUpsertResourceShare).not.toHaveBeenCalled()
    })
  })
})
