/**
 * Tests for the fork sync (promote) route's error projection and input mapping.
 *
 * `promoteFork` returns its deliberate refusals as a `blocked` result, but a classified
 * failure raised deeper in the copy — the target workspace's folder ceiling being full —
 * throws. `withRouteHandler` only understands `HttpError`, so without an explicit branch
 * that throw renders as an opaque 500.
 */
import { user } from '@sim/db/schema'
import { auditMock, authMockFns, createMockRequest, type MockUser } from '@sim/testing'
import { createRouteContext } from '@sim/testing/helpers/http'
import { queueTableRows, resetDbChainMock } from '@sim/testing/mocks/database.mock'
import { permissionsMock, permissionsMockFns } from '@sim/testing/mocks/permissions.mock'
import {
  workspaceAuthorizationMock,
  workspaceAuthorizationMockFns,
} from '@sim/testing/mocks/workspace-authorization.mock'
import { workspaceForkingAuthzMock } from '@sim/testing/mocks/workspace-forking-authz.mock'
import {
  workspaceForkingLineageMock,
  workspaceForkingLineageMockFns,
} from '@sim/testing/mocks/workspace-forking-lineage.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FolderCollectionFullError } from '@/lib/folders/errors'

const { mockPromoteFork } = vi.hoisted(() => ({
  mockPromoteFork: vi.fn(),
}))

vi.mock('@sim/audit', () => auditMock)
vi.mock('@/ee/workspace-forking/lib/promote/promote', () => ({ promoteFork: mockPromoteFork }))
vi.mock('@/ee/workspace-forking/lib/lineage/authz', () => workspaceForkingAuthzMock)

vi.mock('@/lib/core/application/workspace-authorization', () => workspaceAuthorizationMock)
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/ee/workspace-forking/lib/lineage/lineage', () => workspaceForkingLineageMock)

import { POST } from '@/app/api/workspaces/[id]/fork/promote/route'

const { mockAuthorizeWorkspaceOperation } = workspaceAuthorizationMockFns

workspaceForkingLineageMockFns.mockResolveForkEdge.mockImplementation(async () => ({
  childWorkspaceId: 'ws-child',
  parentWorkspaceId: 'ws-parent',
}))

permissionsMockFns.mockGetWorkspaceWithOwner.mockImplementation(async (id: string) => ({
  id,
  name: id === 'ws-child' ? 'Child' : 'Parent',
  organizationId: null,
  allowPersonalApiKeys: true,
}))

const TEST_USER: MockUser = { id: 'user-1', email: 'a@b.com', name: 'A' }
const WORKSPACE_ID = 'ws-child'
const routeContext = createRouteContext({ id: WORKSPACE_ID })

const FULL_MESSAGE =
  'This workspace has reached its limit of 10,000 workflow folders. Delete folders you no longer need before creating another one.'

function promoteRequest() {
  return createMockRequest(
    'POST',
    { otherWorkspaceId: 'ws-parent', direction: 'push' },
    { 'content-type': 'application/json' },
    `http://localhost:3000/api/workspaces/${WORKSPACE_ID}/fork/promote`
  )
}

describe('POST /api/workspaces/[id]/fork/promote', () => {
  beforeEach(() => {
    authMockFns.mockGetSession.mockResolvedValue({ user: TEST_USER, session: { id: 'session-1' } })
    resetDbChainMock()
    queueTableRows(user, [{ name: TEST_USER.name }])
    mockAuthorizeWorkspaceOperation.mockResolvedValue(undefined)
  })

  it('renders a full-folder-tree refusal as an actionable 409', async () => {
    mockPromoteFork.mockRejectedValue(new FolderCollectionFullError('workflow', 10_000))

    const response = await POST(promoteRequest(), routeContext)

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: FULL_MESSAGE })
  })

  /** The copy runs inside a transaction, so drizzle wraps the throw; the cause chain matters. */
  it('classifies a refusal that drizzle wrapped in a transaction error', async () => {
    mockPromoteFork.mockRejectedValue(
      new Error('select "folder"."id" from "folder" ...', {
        cause: new FolderCollectionFullError('workflow', 10_000),
      })
    )

    const response = await POST(promoteRequest(), routeContext)

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: FULL_MESSAGE })
  })

  it('rethrows an unclassified failure instead of dressing it as a 409', async () => {
    mockPromoteFork.mockRejectedValue(new Error('connection reset'))

    const response = await POST(promoteRequest(), routeContext)

    expect(response.status).toBe(500)
  })
})
