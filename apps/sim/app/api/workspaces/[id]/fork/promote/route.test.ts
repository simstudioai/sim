/**
 * Tests for the fork sync (promote) route's error projection and input mapping.
 *
 * `promoteFork` returns its deliberate refusals as a `blocked` result, but a classified
 * failure raised deeper in the copy — the target workspace's folder ceiling being full —
 * throws. `withRouteHandler` only understands `HttpError`, so without an explicit branch
 * that throw renders as an opaque 500.
 *
 * @vitest-environment node
 */
import { user } from '@sim/db/schema'
import { auditMock, authMockFns, createMockRequest, type MockUser } from '@sim/testing'
import { queueTableRows, resetDbChainMock } from '@sim/testing/mocks/database.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FolderCollectionFullError } from '@/lib/folders/errors'

const { mockLogger, mockPromoteFork, mockAuthorizeWorkspaceOperation } = vi.hoisted(() => ({
  mockLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  },
  mockPromoteFork: vi.fn(),
  mockAuthorizeWorkspaceOperation: vi.fn(),
}))

vi.mock('@sim/audit', () => auditMock)
vi.mock('@sim/logger', () => ({
  createLogger: vi.fn().mockReturnValue(mockLogger),
  runWithRequestContext: <T>(_ctx: unknown, fn: () => T): T => fn(),
  getRequestContext: () => undefined,
}))
vi.mock('@/ee/workspace-forking/lib/promote/promote', () => ({ promoteFork: mockPromoteFork }))
vi.mock('@/ee/workspace-forking/lib/lineage/authz', () => ({
  assertForkingEnabled: vi.fn(),
  ForkError: class extends Error {},
}))

vi.mock('@/lib/core/application/workspace-authorization', () => ({
  authorizeWorkspaceOperation: mockAuthorizeWorkspaceOperation,
  requireAllowedWorkspacePrincipal: vi.fn(),
}))
vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getWorkspaceWithOwner: vi.fn(async (id: string) => ({
    id,
    name: id === 'ws-child' ? 'Child' : 'Parent',
    organizationId: null,
    allowPersonalApiKeys: true,
  })),
}))
vi.mock('@/ee/workspace-forking/lib/lineage/lineage', () => ({
  resolveForkEdge: vi.fn(async () => ({
    childWorkspaceId: 'ws-child',
    parentWorkspaceId: 'ws-parent',
  })),
}))

import { POST } from '@/app/api/workspaces/[id]/fork/promote/route'

const TEST_USER: MockUser = { id: 'user-1', email: 'a@b.com', name: 'A' }
const WORKSPACE_ID = 'ws-child'
const routeContext = { params: Promise.resolve({ id: WORKSPACE_ID }) }

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
    vi.clearAllMocks()
    authMockFns.mockGetSession.mockResolvedValue({ user: TEST_USER, session: { id: 'session-1' } })
    resetDbChainMock()
    queueTableRows(user, [{ name: TEST_USER.name }])
    mockAuthorizeWorkspaceOperation.mockResolvedValue(undefined)
  })

  /**
   * The shared application use case resolves the other side's name and the actor attribution
   * before the manager records the sync activity.
   */
  it('names the other side of the edge for promoteFork to record the sync', async () => {
    mockPromoteFork.mockResolvedValue({
      promoteRunId: 'run-1',
      updated: 1,
      created: 0,
      archived: 0,
      redeployed: 1,
      deployFailed: 0,
      deployWarnings: [],
      unmappedRequired: [],
      blockers: [],
      blocked: null,
      updatedNames: ['Flow'],
      createdNames: [],
      archivedNames: [],
      needsConfiguration: [],
      clearedOptional: [],
      droppedReferences: [],
      triggerUrlChanges: [],
    })

    const response = await POST(promoteRequest(), routeContext)

    expect(response.status).toBe(200)
    expect(mockPromoteFork).toHaveBeenCalledWith(
      expect.objectContaining({ direction: 'push', actorName: 'A', otherWorkspaceName: 'Parent' })
    )
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
