/**
 * @vitest-environment node
 */
import {
  auditMock,
  createMockRequest,
  dbChainMock,
  dbChainMockFns,
  hybridAuthMockFns,
  permissionsMock,
  permissionsMockFns,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
  workflowAuthzMockFns,
  workflowsApiUtilsMock,
  workflowsPersistenceUtilsMock,
  workflowsPersistenceUtilsMockFns,
} from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockWorkflowCreated } = vi.hoisted(() => ({
  mockWorkflowCreated: vi.fn(),
}))

const mockGetUserEntityPermissions = permissionsMockFns.mockGetUserEntityPermissions

vi.mock('@sim/db', () => dbChainMock)

vi.mock('@sim/audit', () => auditMock)

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

vi.mock('@/app/api/workflows/utils', () => workflowsApiUtilsMock)

vi.mock('@/lib/core/telemetry', () => ({
  PlatformEvents: {
    workflowCreated: (...args: unknown[]) => mockWorkflowCreated(...args),
  },
}))

vi.mock('@/lib/workflows/defaults', () => ({
  buildDefaultWorkflowArtifacts: vi.fn().mockReturnValue({
    workflowState: { blocks: {}, edges: [], loops: {}, parallels: {} },
    subBlockValues: {},
    startBlockId: 'start-block-id',
  }),
}))

vi.mock('@/lib/workflows/persistence/utils', () => workflowsPersistenceUtilsMock)

import { POST } from '@/app/api/workflows/route'

describe('Workflows API Route - POST ordering', () => {
  afterAll(() => {
    resetDbChainMock()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()

    vi.stubGlobal('crypto', {
      randomUUID: vi.fn().mockReturnValue('workflow-new-id'),
    })

    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-123',
      userName: 'Test User',
      userEmail: 'test@example.com',
    })
    mockGetUserEntityPermissions.mockResolvedValue('write')
    workflowAuthzMockFns.mockAssertFolderMutable.mockResolvedValue(undefined)
    workflowsPersistenceUtilsMockFns.mockSaveWorkflowToNormalizedTables.mockResolvedValue({
      success: true,
    })
  })

  it('rejects creating a workflow inside a locked folder', async () => {
    const { FolderLockedError } = await import('@sim/platform-authz/workflow')
    workflowAuthzMockFns.mockAssertFolderMutable.mockRejectedValueOnce(
      new FolderLockedError('Folder is locked')
    )

    const req = createMockRequest('POST', {
      name: 'New Workflow',
      description: 'desc',
      workspaceId: 'workspace-123',
      folderId: 'locked-folder',
    })

    const response = await POST(req)
    expect(response.status).toBe(423)
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })

  it('uses top insertion against mixed siblings (folders + workflows)', async () => {
    queueTableRows(schemaMock.workflow, [])
    queueTableRows(schemaMock.workflow, [{ minOrder: 5 }])
    queueTableRows(schemaMock.workflowFolder, [{ minOrder: 2 }])

    const req = createMockRequest('POST', {
      name: 'New Workflow',
      description: 'desc',
      workspaceId: 'workspace-123',
      folderId: null,
    })

    const response = await POST(req)
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.sortOrder).toBe(1)
    expect(dbChainMockFns.values).toHaveBeenCalledWith(expect.objectContaining({ sortOrder: 1 }))
  })

  it('defaults to sortOrder 0 when there are no siblings', async () => {
    const req = createMockRequest('POST', {
      name: 'New Workflow',
      description: 'desc',
      workspaceId: 'workspace-123',
      folderId: null,
    })

    const response = await POST(req)
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.sortOrder).toBe(0)
    expect(dbChainMockFns.values).toHaveBeenCalledWith(expect.objectContaining({ sortOrder: 0 }))
  })
})
