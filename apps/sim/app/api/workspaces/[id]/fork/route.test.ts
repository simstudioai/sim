/**
 * Tests for the workspace fork route's error projection.
 *
 * The fork copy mirrors the source folder tree into the child and refuses when that would
 * cross the child's `MAX_FOLDERS_PER_WORKSPACE` ceiling. That refusal is a classified
 * `OrchestrationError`, which `withRouteHandler` alone renders as an opaque 500 — it only
 * understands `HttpError`. These pin that the caller gets the actionable 409 instead.
 *
 * @vitest-environment node
 */
import { auditMock, authMockFns, createMockRequest, type MockUser } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FolderCollectionFullError } from '@/lib/folders/errors'

const { mockLogger, mockCreateFork, mockAssertCanFork } = vi.hoisted(() => ({
  mockLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  },
  mockCreateFork: vi.fn(),
  mockAssertCanFork: vi.fn(),
}))

vi.mock('@sim/audit', () => auditMock)
vi.mock('@sim/logger', () => ({
  createLogger: vi.fn().mockReturnValue(mockLogger),
  runWithRequestContext: <T>(_ctx: unknown, fn: () => T): T => fn(),
  getRequestContext: () => undefined,
}))
vi.mock('@/ee/workspace-forking/lib/create-fork', () => ({ createFork: mockCreateFork }))
vi.mock('@/ee/workspace-forking/lib/lineage/authz', () => ({ assertCanFork: mockAssertCanFork }))

import { POST } from '@/app/api/workspaces/[id]/fork/route'

const TEST_USER: MockUser = { id: 'user-1', email: 'a@b.com', name: 'A' }
const SOURCE_WORKSPACE_ID = 'ws-source'
const routeContext = { params: Promise.resolve({ id: SOURCE_WORKSPACE_ID }) }

const FULL_MESSAGE =
  'This workspace has reached its limit of 10,000 workflow folders. Delete folders you no longer need before creating another one.'

function forkRequest() {
  return createMockRequest(
    'POST',
    { name: 'Child' },
    { 'content-type': 'application/json' },
    `http://localhost:3000/api/workspaces/${SOURCE_WORKSPACE_ID}/fork`
  )
}

describe('POST /api/workspaces/[id]/fork', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMockFns.mockGetSession.mockResolvedValue({ user: TEST_USER })
    mockAssertCanFork.mockResolvedValue({
      source: { id: SOURCE_WORKSPACE_ID, name: 'Source' },
      policy: {},
    })
  })

  it('renders a full-folder-tree refusal as an actionable 409', async () => {
    mockCreateFork.mockRejectedValue(new FolderCollectionFullError('workflow', 10_000))

    const response = await POST(forkRequest(), routeContext)

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: FULL_MESSAGE })
  })

  /**
   * Drizzle re-wraps anything thrown inside a `db.transaction` callback, and the fork copy
   * runs inside one — so an `instanceof` check at this layer would miss it and fall through
   * to the generic 500. The projection must walk the cause chain.
   */
  it('classifies a refusal that drizzle wrapped in a transaction error', async () => {
    const wrapped = new Error('select "folder"."id" from "folder" ...', {
      cause: new FolderCollectionFullError('workflow', 10_000),
    })
    mockCreateFork.mockRejectedValue(wrapped)

    const response = await POST(forkRequest(), routeContext)

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: FULL_MESSAGE })
  })

  /** An unclassified fault must keep falling through to the handler's generic 500. */
  it('rethrows an unclassified failure instead of dressing it as a 409', async () => {
    mockCreateFork.mockRejectedValue(new Error('connection reset'))

    const response = await POST(forkRequest(), routeContext)

    expect(response.status).toBe(500)
  })

  it('still returns the created fork when the copy succeeds', async () => {
    mockCreateFork.mockResolvedValue({
      workspace: { id: 'ws-child', name: 'Child' },
      workflowsCopied: 2,
    })

    const response = await POST(forkRequest(), routeContext)

    expect(response.status).toBe(201)
  })
})
