/**
 * DELETE /api/v1/tables/[tableId] projects an orchestration failure onto the
 * wire. Two properties of that projection are load-bearing and have regressed
 * before, so they are pinned here rather than left to the helper's own unit
 * test: an UNCLASSIFIED failure must never reach an API-key holder (its message
 * is whatever the fault happened to carry — a driver's failed SQL and its bound
 * parameters), and a `locked` failure must carry `lock` so the client knows
 * which lock to clear.
 */
import { createMockRequest } from '@sim/testing'
import { NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckRateLimit,
  mockCheckWorkspaceScope,
  mockGetTableById,
  mockCheckWorkspaceAccess,
  mockPerformDeleteTable,
  mockResolveWorkspaceRequestActor,
} = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockCheckWorkspaceScope: vi.fn(),
  mockGetTableById: vi.fn(),
  mockCheckWorkspaceAccess: vi.fn(),
  mockPerformDeleteTable: vi.fn(),
  mockResolveWorkspaceRequestActor: vi.fn(),
}))

/** The shape `checkAccess` reads: the viewer's permission plus the workspace it just loaded. */
function workspaceAccess(permission: string | null, organizationId: string | null = 'org-1') {
  return {
    exists: true,
    hasAccess: permission !== null,
    canWrite: permission === 'admin' || permission === 'write',
    canAdmin: permission === 'admin',
    workspace: { id: 'ws-1', organizationId },
    permission,
  }
}

vi.mock('@/app/api/v1/middleware', () => ({
  checkRateLimit: mockCheckRateLimit,
  checkWorkspaceScope: mockCheckWorkspaceScope,
  createRateLimitResponse: () => NextResponse.json({ error: 'Rate limited' }, { status: 429 }),
  /**
   * Mirrors the real `tableAccessPrincipal`, which branches on `keyType` being
   * `'personal'` — NOT on it being `'workspace'`. Only a personal key names a
   * person; anything else, an absent `keyType` included, reaches `checkAccess`
   * as the workspace so no bystander's permission group is applied to it.
   */
  tableAccessPrincipal: (rateLimit: { keyType?: string; userId?: string }) =>
    rateLimit.keyType === 'personal'
      ? { kind: 'user', userId: rateLimit.userId }
      : { kind: 'workspace_api_key', keyCreatorUserId: rateLimit.userId },
  /**
   * Mirrors the real resolver: a workspace key names no human, so the billed
   * account stands in as the explicit system actor; anything else keeps its
   * owner. The route reads it through `requireWorkspaceRequestActor`, which
   * projects an unresolvable actor onto a 400 instead of throwing, so the mock
   * reproduces that projection rather than only the raw resolver.
   */
  resolveWorkspaceRequestActor: mockResolveWorkspaceRequestActor,
  requireWorkspaceRequestActor: async (rateLimit: unknown, workspaceId: string) => {
    const actorUserId = await mockResolveWorkspaceRequestActor(rateLimit, workspaceId)
    return actorUserId
      ? { ok: true, actorUserId }
      : {
          ok: false,
          response: NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 }),
        }
  },
}))

vi.mock('@/lib/table', () => ({
  buildFilterClause: vi.fn(),
  getTableById: mockGetTableById,
  TableQueryValidationError: class TableQueryValidationError extends Error {},
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  checkWorkspaceAccess: mockCheckWorkspaceAccess,
  /** The v1 middleware reads the permission alone; `checkAccess` reads the whole access. */
  getUserEntityPermissions: async (...args: unknown[]) =>
    (await mockCheckWorkspaceAccess(...args)).permission,
}))

vi.mock('@/lib/workspaces/utils', () => ({
  getWorkspaceOrganizationId: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/table/orchestration', () => ({
  performDeleteTable: mockPerformDeleteTable,
}))

import { DELETE } from '@/app/api/v1/tables/[tableId]/route'

const TABLE_ID = '22222222-2222-4222-8222-222222222222'
const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111'

function makeRequest() {
  return createMockRequest(
    'DELETE',
    undefined,
    {},
    `http://localhost:3000/api/v1/tables/${TABLE_ID}?workspaceId=${WORKSPACE_ID}`
  )
}

function makeContext() {
  return { params: Promise.resolve({ tableId: TABLE_ID }) }
}

describe('DELETE /api/v1/tables/[tableId] — orchestration failure projection', () => {
  beforeEach(() => {
    mockCheckRateLimit.mockResolvedValue({ allowed: true, userId: 'user-1', keyType: 'personal' })
    mockCheckWorkspaceScope.mockResolvedValue(null)
    mockResolveWorkspaceRequestActor.mockResolvedValue('user-1')
    mockGetTableById.mockResolvedValue({
      id: TABLE_ID,
      name: 'Table',
      workspaceId: WORKSPACE_ID,
    })
    mockCheckWorkspaceAccess.mockResolvedValue(workspaceAccess('admin'))
  })

  /**
   * A workspace key whose workspace has since been archived resolves no billed
   * account, so there is no system actor to attribute the deletion to. That is
   * a reachable request about an unreachable workspace, not a server fault: it
   * used to `throw`, and the catch-all reported it as a 500.
   */
  it('reports an unresolvable workspace actor as a 400, not a 500', async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: true, userId: 'user-1', keyType: 'workspace' })
    mockResolveWorkspaceRequestActor.mockResolvedValue(null)

    const response = await DELETE(makeRequest(), makeContext())

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Invalid workspace ID' })
    expect(mockPerformDeleteTable).not.toHaveBeenCalled()
  })

  it('returns 423 with the rejecting lock kind', async () => {
    mockPerformDeleteTable.mockResolvedValue({
      success: false,
      error: 'Table is locked against deletion',
      errorCode: 'locked',
      lock: 'delete',
    })

    const response = await DELETE(makeRequest(), makeContext())

    expect(response.status).toBe(423)
    expect(await response.json()).toEqual({
      error: 'Table is locked against deletion',
      lock: 'delete',
    })
  })
})
