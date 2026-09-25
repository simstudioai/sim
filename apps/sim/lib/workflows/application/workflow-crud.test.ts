import {
  createPersonalApiKeyPrincipal,
  createWorkspaceApiKeyPrincipal,
} from '@sim/testing/factories/principal.factory'
import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import { folderQueriesMock, folderQueriesMockFns } from '@sim/testing/mocks/folder-queries.mock'
import { realtimeNotifyMock, realtimeNotifyMockFns } from '@sim/testing/mocks/realtime-notify.mock'
import { telemetryMock } from '@sim/testing/mocks/telemetry.mock'
import {
  workflowContextMock,
  workflowContextMockFns,
} from '@sim/testing/mocks/workflow-context.mock'
import {
  workflowsOrchestrationMock,
  workflowsOrchestrationMockFns,
} from '@sim/testing/mocks/workflows-orchestration.mock'
import {
  workflowsPersistenceUtilsMock,
  workflowsPersistenceUtilsMockFns,
} from '@sim/testing/mocks/workflows-persistence-utils.mock'
import {
  workflowsQueriesMock,
  workflowsQueriesMockFns,
} from '@sim/testing/mocks/workflows-queries.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceContextMock,
  workspaceContextMockFns,
} from '@sim/testing/mocks/workspace-context.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  resolveFolderPath: vi.fn(),
  folderPathForId: vi.fn(),
}))

vi.mock('@sim/audit', () => auditMock)

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

vi.mock('@/lib/workspaces/application/workspace-context', () => workspaceContextMock)

vi.mock('@/lib/workflows/application/context', () => workflowContextMock)

vi.mock('@/lib/workflows/application/workflow-folders', () => ({
  resolveWorkflowFolderPath: hoisted.resolveFolderPath,
  workflowFolderPathForId: hoisted.folderPathForId,
}))

vi.mock('@/lib/workflows/orchestration', () => workflowsOrchestrationMock)

vi.mock('@/lib/folders/queries', () => folderQueriesMock)

vi.mock('@/lib/workflows/queries', () => workflowsQueriesMock)

vi.mock('@/lib/workflows/input-format', () => ({
  extractInputFieldsFromBlocks: vi.fn().mockReturnValue([]),
}))

vi.mock('@/lib/workflows/persistence/utils', () => workflowsPersistenceUtilsMock)

vi.mock('@/lib/realtime/notify', () => realtimeNotifyMock)

vi.mock('@/lib/core/telemetry', () => telemetryMock)

import { MAX_FOLDERS_PER_WORKSPACE } from '@/lib/folders/constants'
import { createWorkflow } from '@/lib/workflows/application/create-workflow'
import { listWorkflowVersions } from '@/lib/workflows/application/list-workflow-versions'
import { readWorkflow, readWorkflowMetadata } from '@/lib/workflows/application/read-workflow'
import { updateWorkflow } from '@/lib/workflows/application/update-workflow'

const mocks = {
  ...hoisted,
  createTransition: workflowsOrchestrationMockFns.mockPerformCreateWorkflowTransition,
  updateRecord: workflowsOrchestrationMockFns.mockUpdateWorkflowRecord,
  deleteRecord: workflowsOrchestrationMockFns.mockDeleteWorkflowRecord,
  listRows: workflowsQueriesMockFns.mockListWorkspaceWorkflows,
  loadSnapshot: workflowsQueriesMockFns.mockLoadWorkflowReadSnapshot,
  loadFolderIndex: folderQueriesMockFns.mockLoadActiveFolderPathIndex,
}

const mockListVersions = workflowsPersistenceUtilsMockFns.mockListWorkflowVersions
const mockReadVersion = workflowsPersistenceUtilsMockFns.mockGetWorkflowDeploymentVersion
const mockLoadNormalized = workflowsPersistenceUtilsMockFns.mockLoadWorkflowFromNormalizedTables

const mockRecordAudit = auditMockFns.mockRecordAudit
const mockResolvePermission = workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission
const mockResolveWorkspaceContext =
  workspaceContextMockFns.mockResolveActiveWorkspaceApplicationContext
const mockResolveWorkflowContext =
  workflowContextMockFns.mockResolveActiveWorkflowApplicationContext
const mockNotifyWorkflowUpdated = realtimeNotifyMockFns.mockNotifyWorkflowUpdated
const mockNotifyWorkspaceWorkflowsChanged =
  realtimeNotifyMockFns.mockNotifyWorkspaceWorkflowsChanged

const WORKSPACE_ID = 'workspace-1'
const WORKFLOW_ID = 'workflow-1'
const now = new Date('2026-08-01T00:00:00.000Z')
const workflowRecord = {
  id: WORKFLOW_ID,
  userId: 'owner-1',
  workspaceId: WORKSPACE_ID,
  folderId: null,
  name: 'Daily digest',
  description: null,
  variables: {},
  isDeployed: false,
  deployedAt: null,
  runCount: 0,
  lastRunAt: null,
  archivedAt: null,
  createdAt: now,
  updatedAt: now,
}
const workspaceContext = {
  workspaceId: WORKSPACE_ID,
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}
const workflowContext = {
  ...workspaceContext,
  workflowId: WORKFLOW_ID,
  workflow: workflowRecord,
}
const personalPrincipal = createPersonalApiKeyPrincipal({ keyId: 'personal-key-1' })
const workspacePrincipal = createWorkspaceApiKeyPrincipal({
  workspaceId: WORKSPACE_ID,
  keyId: 'workspace-key-1',
})
const executorPrincipal = {
  kind: 'delegated' as const,
  serviceId: 'executor' as const,
  subjectUserId: 'user-1',
  workspaceId: WORKSPACE_ID,
  delegationId: 'executor-1',
  audience: 'sim:workflows',
  issuedAt: new Date('2026-08-01T00:00:00Z'),
  expiresAt: new Date('2999-08-01T00:00:00Z'),
  delegationContext: {
    kind: 'workflow_execution' as const,
    workflowId: WORKFLOW_ID,
    executionId: 'origin-run',
  },
}

describe('authorized workflow CRUD and version reads', () => {
  beforeEach(() => {
    mockResolvePermission.mockResolvedValue('admin')
    mockResolveWorkspaceContext.mockResolvedValue(workspaceContext)
    mockResolveWorkflowContext.mockResolvedValue(workflowContext)
    mocks.resolveFolderPath.mockResolvedValue({ folderId: null, index: {} })
    mocks.folderPathForId.mockReturnValue('/')
    mocks.loadFolderIndex.mockResolvedValue({})
    mocks.createTransition.mockResolvedValue({
      success: true,
      workflow: {
        id: WORKFLOW_ID,
        name: workflowRecord.name,
        description: null,
        workspaceId: WORKSPACE_ID,
        folderId: null,
        sortOrder: 0,
        createdAt: now,
        updatedAt: now,
        subBlockValues: {},
      },
    })
    mocks.loadSnapshot.mockResolvedValue({ workflowRecord, normalizedData: { blocks: {} } })
    mockLoadNormalized.mockResolvedValue({
      blocks: {},
      edges: [],
      loops: {},
      parallels: {},
      isFromNormalizedTables: true,
    })
    mocks.deleteRecord.mockResolvedValue({
      success: true,
      archived: true,
      workflow: { id: WORKFLOW_ID, name: workflowRecord.name, workspaceId: WORKSPACE_ID },
    })
    mocks.updateRecord.mockResolvedValue({
      success: true,
      workflow: workflowRecord,
    })
    mockListVersions.mockResolvedValue({ versions: [] })
    mockReadVersion.mockResolvedValue({
      id: 'version-1',
      version: 1,
      name: null,
      description: null,
      isActive: true,
      createdAt: now,
      state: { blocks: {}, edges: [], loops: {}, parallels: {}, version: '1.0' },
    })
  })

  it('refuses metadata to a removed member before resolving folder paths', async () => {
    mockResolvePermission.mockResolvedValue(null)
    await expect(
      readWorkflowMetadata.execute({
        principal: personalPrincipal,
        input: { workflowId: WORKFLOW_ID, assertedWorkspaceId: WORKSPACE_ID },
      })
    ).rejects.toThrow()
    expect(mocks.loadFolderIndex).not.toHaveBeenCalled()
    expect(mocks.loadSnapshot).not.toHaveBeenCalled()
  })

  it('uses the billing owner only for the workspace key legacy user column', async () => {
    await createWorkflow.execute({
      principal: workspacePrincipal,
      input: { workspaceId: WORKSPACE_ID, name: workflowRecord.name },
    })

    expect(mocks.createTransition).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'billing-owner-1' })
    )
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: null,
        actorName: 'Workspace API key',
        metadata: expect.objectContaining({
          actor: createWorkspaceApiKeyPrincipal({
            keyId: 'workspace-key-1',
            workspaceId: WORKSPACE_ID,
          }),
        }),
      })
    )
  })

  it('returns forbidden when a workspace key does not match canonical workflow scope', async () => {
    await expect(
      readWorkflow.execute({
        principal: { ...workspacePrincipal, workspaceId: 'workspace-other' },
        input: { workflowId: WORKFLOW_ID },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mockResolveWorkflowContext).toHaveBeenCalledWith({
      workflowId: WORKFLOW_ID,
      assertedWorkspaceId: undefined,
    })
    expect(mocks.loadSnapshot).not.toHaveBeenCalled()
  })

  it('rejects executor workflow mutations before canonical resource loading', async () => {
    const executor = {
      kind: 'delegated' as const,
      serviceId: 'executor' as const,
      subjectUserId: 'user-1',
      workspaceId: WORKSPACE_ID,
      delegationId: 'delegation-1',
      audience: 'sim:workflows',
      issuedAt: new Date('2026-08-01T00:00:00Z'),
      expiresAt: new Date('2999-01-01T00:00:00Z'),
      delegationContext: {
        kind: 'workflow_execution' as const,
        workflowId: WORKFLOW_ID,
        executionId: 'execution-1',
      },
    }

    await expect(
      updateWorkflow.execute({
        principal: executor,
        input: { workflowId: WORKFLOW_ID, name: 'Forged target' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mockResolveWorkflowContext).not.toHaveBeenCalled()
    expect(mocks.updateRecord).not.toHaveBeenCalled()
  })

  it('allows executor reads only after canonical same-workspace binding and permission recheck', async () => {
    await readWorkflow.execute({
      principal: executorPrincipal,
      input: { workflowId: WORKFLOW_ID },
    })

    expect(mockResolveWorkflowContext).toHaveBeenCalledWith({
      workflowId: WORKFLOW_ID,
      assertedWorkspaceId: undefined,
    })
    expect(mockResolvePermission).toHaveBeenCalledWith('user-1', WORKSPACE_ID, null, undefined, {
      forUpdate: undefined,
    })
    expect(mocks.loadSnapshot).toHaveBeenCalledWith(WORKFLOW_ID, WORKSPACE_ID)
  })

  it('rejects executor reads whose canonical target is outside the signed origin workspace', async () => {
    mockResolveWorkflowContext.mockResolvedValueOnce({
      ...workflowContext,
      workspaceId: 'workspace-other',
      workflow: { ...workflowRecord, workspaceId: 'workspace-other' },
    })

    await expect(
      readWorkflow.execute({
        principal: executorPrincipal,
        input: { workflowId: WORKFLOW_ID },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.loadSnapshot).not.toHaveBeenCalled()
  })

  it('rechecks current permission for every workflow mutation', async () => {
    mockResolvePermission.mockResolvedValueOnce('write').mockResolvedValueOnce('read')

    await updateWorkflow.execute({
      principal: personalPrincipal,
      input: { workflowId: WORKFLOW_ID, name: 'First update' },
    })
    await expect(
      updateWorkflow.execute({
        principal: personalPrincipal,
        input: { workflowId: WORKFLOW_ID, name: 'Second update' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.updateRecord).toHaveBeenCalledTimes(1)
  })

  /**
   * Both use cases resolve a folder two ways in one function. The folderPath
   * branch goes through `resolveWorkflowFolderPath`, which bounds its path
   * index at `MAX_FOLDERS_PER_WORKSPACE`; the folderId branch loads the index
   * directly and must pass the same cap rather than issuing an unbounded
   * `SELECT` over every folder row in the workspace.
   */
  it.each([
    [
      'createWorkflow',
      () =>
        createWorkflow.execute({
          principal: personalPrincipal,
          input: { workspaceId: WORKSPACE_ID, name: workflowRecord.name, folderId: 'folder-1' },
        }),
    ],
    [
      'updateWorkflow',
      () =>
        updateWorkflow.execute({
          principal: personalPrincipal,
          input: { workflowId: WORKFLOW_ID, folderId: 'folder-1' },
        }),
    ],
  ])('bounds the %s folderId-branch path index at the workspace cap', async (_name, run) => {
    mocks.loadFolderIndex.mockResolvedValue({
      rowById: new Map(),
      pathById: new Map([['folder-1', '/Reports']]),
      idByPath: new Map([['/Reports', 'folder-1']]),
    })

    await run()

    expect(mocks.loadFolderIndex).toHaveBeenCalledTimes(1)
    expect(mocks.loadFolderIndex).toHaveBeenCalledWith(WORKSPACE_ID, 'workflow', undefined, {
      maxRows: MAX_FOLDERS_PER_WORKSPACE,
    })
  })

  it('bounds both paginated and legacy unpaginated version listing', async () => {
    await listWorkflowVersions.execute({
      principal: workspacePrincipal,
      input: { workflowId: WORKFLOW_ID, limit: 50 },
    })
    expect(mockListVersions).toHaveBeenLastCalledWith(WORKFLOW_ID, {
      limit: 51,
      afterVersion: undefined,
    })

    await expect(
      listWorkflowVersions.execute({
        principal: workspacePrincipal,
        input: { workflowId: WORKFLOW_ID },
      })
    ).resolves.toEqual({ versions: [], hasMore: false })
    expect(mockListVersions).toHaveBeenLastCalledWith(WORKFLOW_ID, {
      limit: 1001,
      afterVersion: undefined,
    })

    mockListVersions.mockResolvedValue({
      versions: Array.from({ length: 1001 }, (_, index) => ({ id: `version-${index}` })),
    })
    await expect(
      listWorkflowVersions.execute({
        principal: workspacePrincipal,
        input: { workflowId: WORKFLOW_ID },
      })
    ).rejects.toThrow('Workflow version list exceeds the 1000 row limit')
  })
})
