/**
 * Tests for the admin workspace import route.
 *
 * The import creates one folder per path segment through `ensureImportFolder`, a raw insert
 * that used to bypass the `MAX_FOLDERS_PER_WORKSPACE` ceiling the capped folder readers
 * materialize under. These pin that the ceiling is enforced and surfaces as a 409.
 *
 * @vitest-environment node
 */
import { createMockRequest, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_FOLDERS_PER_WORKSPACE } from '@/lib/folders/constants'

const {
  mockLogger,
  mockGetWorkspaceWithOwner,
  mockParseWorkflowJson,
  mockExtractWorkflowName,
  mockPrepareWorkflowStateForPersistence,
  mockSaveWorkflowToNormalizedTables,
  mockDeduplicateWorkflowName,
  mockNormalizeImportedVariables,
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
  mockGetWorkspaceWithOwner: vi.fn(),
  mockParseWorkflowJson: vi.fn(),
  mockExtractWorkflowName: vi.fn(),
  mockPrepareWorkflowStateForPersistence: vi.fn(),
  mockSaveWorkflowToNormalizedTables: vi.fn(),
  mockDeduplicateWorkflowName: vi.fn(),
  mockNormalizeImportedVariables: vi.fn(),
  mockNotifyWorkspace: vi.fn(),
}))

vi.mock('@sim/logger', () => ({
  createLogger: vi.fn().mockReturnValue(mockLogger),
  runWithRequestContext: <T>(_ctx: unknown, fn: () => T): T => fn(),
  getRequestContext: () => undefined,
}))
vi.mock('@/app/api/v1/admin/middleware', () => ({
  withAdminAuthParams: (handler: unknown) => handler,
}))
vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getWorkspaceWithOwner: mockGetWorkspaceWithOwner,
}))
vi.mock('@/lib/workflows/operations/import-export', () => ({
  parseWorkflowJson: mockParseWorkflowJson,
  extractWorkflowName: mockExtractWorkflowName,
  extractWorkflowsFromZip: vi.fn(),
}))
vi.mock('@/lib/workflows/persistence/prepare-state', () => ({
  prepareWorkflowStateForPersistence: mockPrepareWorkflowStateForPersistence,
}))
vi.mock('@/lib/workflows/persistence/utils', () => ({
  saveWorkflowToNormalizedTables: mockSaveWorkflowToNormalizedTables,
}))
vi.mock('@/lib/workflows/utils', () => ({ deduplicateWorkflowName: mockDeduplicateWorkflowName }))
vi.mock('@/lib/workflows/variables/parse', () => ({
  normalizeImportedVariables: mockNormalizeImportedVariables,
}))
vi.mock('@/lib/realtime/notify', () => ({
  notifyWorkspaceWorkflowsChanged: mockNotifyWorkspace,
}))

import { POST } from '@/app/api/v1/admin/workspaces/[id]/import/route'

const WORKSPACE_ID = 'ws-1'
const routeContext = { params: Promise.resolve({ id: WORKSPACE_ID }) }

const FULL_MESSAGE =
  'This workspace has reached its limit of 10,000 workflow folders. Delete folders you no longer need before creating another one.'

function importRequest() {
  return createMockRequest(
    'POST',
    { workflows: [{ content: '{}', name: 'Report', folderPath: ['Reports'] }] },
    { 'content-type': 'application/json' },
    `http://localhost:3000/api/v1/admin/workspaces/${WORKSPACE_ID}/import`
  )
}

/**
 * Queues the two lookups `ensureImportFolder` runs before it inserts — the lock-free reuse
 * probe and the re-check under the folder mutation lock — then the ceiling count.
 */
function queueFolderCreateReads(activeFolderCount: number) {
  queueTableRows(schemaMock.folder, [])
  queueTableRows(schemaMock.folder, [])
  queueTableRows(schemaMock.folder, [{ total: activeFolderCount }])
}

describe('admin workspace import POST', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockGetWorkspaceWithOwner.mockResolvedValue({ id: WORKSPACE_ID, ownerId: 'owner-1' })
    mockParseWorkflowJson.mockReturnValue({ data: { blocks: {}, edges: [] }, errors: [] })
    mockExtractWorkflowName.mockReturnValue('Report')
    mockPrepareWorkflowStateForPersistence.mockReturnValue({ state: {}, warnings: [] })
    mockSaveWorkflowToNormalizedTables.mockResolvedValue({ success: true })
    mockDeduplicateWorkflowName.mockResolvedValue('Report')
    mockNormalizeImportedVariables.mockReturnValue({})
  })

  it('imports a workflow whose folder still fits under the ceiling', async () => {
    queueFolderCreateReads(MAX_FOLDERS_PER_WORKSPACE - 1)

    const response = await POST(importRequest(), routeContext)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ imported: 1, failed: 0 })
    expect(mockNotifyWorkspace).toHaveBeenCalledOnce()
    expect(mockNotifyWorkspace).toHaveBeenCalledWith(WORKSPACE_ID)
  })

  /**
   * The whole import fails rather than recording N identical per-workflow errors behind a
   * 200: a full folder tree is a property of the workspace, not of any one workflow.
   */
  it('refuses the import with a 409 once the workspace is at the folder ceiling', async () => {
    queueFolderCreateReads(MAX_FOLDERS_PER_WORKSPACE)

    const response = await POST(importRequest(), routeContext)

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: { code: 'CONFLICT', message: FULL_MESSAGE },
    })
  })

  /** An over-cap workspace must still be able to import into folders that already exist. */
  it('imports into an existing folder without consulting the ceiling', async () => {
    queueTableRows(schemaMock.folder, [{ id: 'folder-existing' }])

    const response = await POST(importRequest(), routeContext)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ imported: 1, failed: 0 })
  })
})
