/**
 * Tests for the folder duplication route (/api/folders/[id]/duplicate).
 *
 * Duplication is the recursive create path: one call copies a whole subtree, so it is the
 * write most able to push a workspace past `MAX_FOLDERS_PER_WORKSPACE` — the ceiling every
 * capped folder reader materializes under. These pin that the whole subtree is charged
 * against the ceiling in one check, before anything is inserted.
 *
 * @vitest-environment node
 */
import {
  auditMock,
  authMockFns,
  createMockRequest,
  type MockUser,
  permissionsMock,
  permissionsMockFns,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_FOLDERS_PER_WORKSPACE } from '@/lib/folders/constants'

const {
  mockLogger,
  mockNextFolderSortOrder,
  mockDeduplicateFolderName,
  mockDuplicateWorkflow,
  mockAcquireFolderMutationLock,
  mockWithFolderTreeLock,
  mockNotifyWorkspace,
} = vi.hoisted(() => ({
  mockLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  },
  mockNextFolderSortOrder: vi.fn(),
  mockDeduplicateFolderName: vi.fn(),
  mockDuplicateWorkflow: vi.fn(),
  mockAcquireFolderMutationLock: vi.fn(),
  mockWithFolderTreeLock: vi.fn(),
  mockNotifyWorkspace: vi.fn(),
}))

vi.mock('@sim/audit', () => auditMock)
vi.mock('@sim/logger', () => ({
  createLogger: vi.fn().mockReturnValue(mockLogger),
  runWithRequestContext: <T>(_ctx: unknown, fn: () => T): T => fn(),
  getRequestContext: () => undefined,
}))
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/lib/folders/orchestration', () => ({ nextFolderSortOrder: mockNextFolderSortOrder }))
vi.mock('@/lib/folders/locks', () => ({
  acquireFolderMutationLock: mockAcquireFolderMutationLock,
  withFolderTreeLock: mockWithFolderTreeLock,
}))
vi.mock('@/lib/folders/naming', () => ({ deduplicateFolderName: mockDeduplicateFolderName }))
vi.mock('@/lib/workflows/persistence/duplicate', () => ({
  duplicateWorkflow: mockDuplicateWorkflow,
}))
vi.mock('@/lib/realtime/notify', () => ({
  notifyWorkspaceWorkflowsChanged: mockNotifyWorkspace,
}))

import { POST } from '@/app/api/folders/[id]/duplicate/route'

const TEST_USER: MockUser = { id: 'user-123', email: 'test@example.com', name: 'Test User' }
const WORKSPACE_ID = 'workspace-123'
const SOURCE_FOLDER_ID = 'folder-source'

const FULL_MESSAGE =
  'This workspace has reached its limit of 10,000 workflow folders. Delete folders you no longer need before creating another one.'

function folderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SOURCE_FOLDER_ID,
    resourceType: 'workflow',
    name: 'Source',
    userId: TEST_USER.id,
    workspaceId: WORKSPACE_ID,
    parentId: null,
    color: '#6B7280',
    isExpanded: true,
    locked: false,
    sortOrder: 0,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    deletedAt: null,
    ...overrides,
  }
}

/**
 * Queues, in the order the route reads them: the source-folder lookup, the workspace folder
 * skeleton the subtree size is measured from, and the ceiling count.
 *
 * `skeleton` describes the SOURCE subtree; `activeFolderCount` is what the workspace already
 * holds. Anything the route reads after the ceiling check is queued by the caller.
 */
function queueDuplicationReads(options: {
  skeleton: Array<{ id: string; parentId: string | null }>
  activeFolderCount: number
}) {
  queueTableRows(schemaMock.folder, [folderRow()])
  queueTableRows(schemaMock.folder, options.skeleton)
  queueTableRows(schemaMock.folder, [{ total: options.activeFolderCount }])
}

function duplicateRequest(body: Record<string, unknown> = { name: 'Copy' }) {
  return createMockRequest('POST', body)
}

const routeContext = { params: Promise.resolve({ id: SOURCE_FOLDER_ID }) }

describe('POST /api/folders/[id]/duplicate', () => {
  afterAll(() => {
    resetDbChainMock()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    authMockFns.mockGetSession.mockResolvedValue({ user: TEST_USER })
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('admin')
    mockNextFolderSortOrder.mockResolvedValue(0)
    mockDeduplicateFolderName.mockImplementation(async (_tx, _ws, _parent, name) => name)
    mockDuplicateWorkflow.mockResolvedValue({ id: 'wf-copy' })
  })

  it('duplicates a folder that still fits under the ceiling', async () => {
    queueDuplicationReads({
      skeleton: [{ id: SOURCE_FOLDER_ID, parentId: null }],
      activeFolderCount: MAX_FOLDERS_PER_WORKSPACE - 1,
    })
    // Child-folder recursion finds nothing, then the response re-reads the new folder.
    queueTableRows(schemaMock.folder, [])
    queueTableRows(schemaMock.folder, [folderRow({ id: 'folder-copy', name: 'Copy' })])

    const response = await POST(duplicateRequest(), routeContext)

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({ folder: { name: 'Copy' } })
    expect(mockNotifyWorkspace).toHaveBeenCalledOnce()
    expect(mockNotifyWorkspace).toHaveBeenCalledWith(WORKSPACE_ID)
  })

  it('refuses a single-folder duplicate once the workspace is at the ceiling', async () => {
    queueDuplicationReads({
      skeleton: [{ id: SOURCE_FOLDER_ID, parentId: null }],
      activeFolderCount: MAX_FOLDERS_PER_WORKSPACE,
    })

    const response = await POST(duplicateRequest(), routeContext)

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: FULL_MESSAGE })
  })

  /**
   * The multiplier case: the workspace has room for one more folder, but the subtree adds
   * four. A per-folder check would happily insert the first three and only then refuse.
   */
  it('refuses a recursive duplicate whose subtree would cross the ceiling, before inserting anything', async () => {
    queueDuplicationReads({
      skeleton: [
        { id: SOURCE_FOLDER_ID, parentId: null },
        { id: 'child-a', parentId: SOURCE_FOLDER_ID },
        { id: 'child-b', parentId: SOURCE_FOLDER_ID },
        { id: 'grandchild', parentId: 'child-a' },
        { id: 'unrelated', parentId: null },
      ],
      activeFolderCount: MAX_FOLDERS_PER_WORKSPACE - 1,
    })

    const response = await POST(duplicateRequest(), routeContext)

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: FULL_MESSAGE })
    // The refusal precedes every write in the copy, so no workflow was duplicated either.
    expect(mockDuplicateWorkflow).not.toHaveBeenCalled()
    expect(mockDeduplicateFolderName).not.toHaveBeenCalled()
  })

  /**
   * The ceiling check must NOT be bought with the workspace-wide folder mutation lock.
   * `pg_advisory_xact_lock` cannot be released early, and this transaction goes on to copy
   * every workflow in the subtree — an unbounded per-workflow loop — so holding it would
   * make an ordinary concurrent folder create fail on the lock timeout the helper installs.
   * The accepted cost is a rare few-row overshoot instead; this pins that choice so
   * re-adding the lock is a visible decision rather than a silent contention regression.
   */
  it('does not hold the workspace folder mutation lock across the workflow copy', async () => {
    queueDuplicationReads({
      skeleton: [{ id: SOURCE_FOLDER_ID, parentId: null }],
      activeFolderCount: 0,
    })
    queueTableRows(schemaMock.folder, [])
    queueTableRows(schemaMock.folder, [folderRow({ id: 'folder-copy', name: 'Copy' })])

    const response = await POST(duplicateRequest(), routeContext)

    expect(response.status).toBe(201)
    expect(mockAcquireFolderMutationLock).not.toHaveBeenCalled()
    expect(mockWithFolderTreeLock).not.toHaveBeenCalled()
  })

  it('allows a subtree that exactly fills the remaining room', async () => {
    queueDuplicationReads({
      skeleton: [
        { id: SOURCE_FOLDER_ID, parentId: null },
        { id: 'child-a', parentId: SOURCE_FOLDER_ID },
      ],
      activeFolderCount: MAX_FOLDERS_PER_WORKSPACE - 2,
    })
    queueTableRows(schemaMock.folder, [])
    queueTableRows(schemaMock.folder, [folderRow({ id: 'folder-copy', name: 'Copy' })])

    const response = await POST(duplicateRequest(), routeContext)

    expect(response.status).toBe(201)
  })
})
