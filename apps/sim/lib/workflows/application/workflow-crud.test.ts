/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  recordAudit: vi.fn(),
  resolvePermission: vi.fn(),
  resolveWorkspaceContext: vi.fn(),
  resolveWorkflowContext: vi.fn(),
  resolveFolderPath: vi.fn(),
  folderPathForId: vi.fn(),
  assertFolderMutable: vi.fn(),
  assertWorkflowMutable: vi.fn(),
  createTransition: vi.fn(),
  updateRecord: vi.fn(),
  deleteRecord: vi.fn(),
  listRows: vi.fn(),
  loadSnapshot: vi.fn(),
  loadFolderIndex: vi.fn(),
  listVersions: vi.fn(),
  readVersion: vi.fn(),
  loadNormalized: vi.fn(),
  notifyWorkflowUpdated: vi.fn(),
  notifyWorkspaceWorkflowsChanged: vi.fn(),
  workflowCreated: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: {
    WORKFLOW_CREATED: 'workflow.created',
    WORKFLOW_DELETED: 'workflow.deleted',
  },
  AuditResourceType: { WORKFLOW: 'workflow' },
  recordAudit: mocks.recordAudit,
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null, required: string) => {
    const rank = { read: 1, write: 2, admin: 3 } as const
    return (
      actual !== null && rank[actual as keyof typeof rank] >= rank[required as keyof typeof rank]
    )
  },
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

vi.mock('@sim/platform-authz/workflow', () => ({
  assertFolderMutable: mocks.assertFolderMutable,
  assertWorkflowMutable: mocks.assertWorkflowMutable,
  FolderLockedError: class FolderLockedError extends Error {},
  WorkflowLockedError: class WorkflowLockedError extends Error {},
}))

vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  resolveActiveWorkspaceApplicationContext: mocks.resolveWorkspaceContext,
}))

vi.mock('@/lib/workflows/application/context', () => ({
  resolveActiveWorkflowApplicationContext: mocks.resolveWorkflowContext,
}))

vi.mock('@/lib/workflows/application/workflow-folders', () => ({
  resolveWorkflowFolderPath: mocks.resolveFolderPath,
  workflowFolderPathForId: mocks.folderPathForId,
}))

vi.mock('@/lib/workflows/orchestration', () => ({
  performCreateWorkflowTransition: mocks.createTransition,
  updateWorkflowRecord: mocks.updateRecord,
  deleteWorkflowRecord: mocks.deleteRecord,
}))

vi.mock('@/lib/folders/queries', () => ({
  loadActiveFolderPathIndex: mocks.loadFolderIndex,
}))

vi.mock('@/lib/workflows/queries', () => ({
  listWorkspaceWorkflows: mocks.listRows,
  loadWorkflowReadSnapshot: mocks.loadSnapshot,
}))

vi.mock('@/lib/workflows/input-format', () => ({
  extractInputFieldsFromBlocks: vi.fn().mockReturnValue([]),
}))

vi.mock('@/lib/workflows/persistence/utils', () => ({
  listWorkflowVersions: mocks.listVersions,
  getWorkflowDeploymentVersion: mocks.readVersion,
  loadWorkflowFromNormalizedTables: mocks.loadNormalized,
}))

vi.mock('@/lib/realtime/notify', () => ({
  notifyWorkflowUpdated: mocks.notifyWorkflowUpdated,
  notifyWorkspaceWorkflowsChanged: mocks.notifyWorkspaceWorkflowsChanged,
}))

vi.mock('@/lib/core/telemetry', () => ({
  PlatformEvents: { workflowCreated: mocks.workflowCreated },
}))

import { MAX_FOLDERS_PER_WORKSPACE } from '@/lib/folders/constants'
import { createWorkflow } from '@/lib/workflows/application/create-workflow'
import { deleteWorkflow } from '@/lib/workflows/application/delete-workflow'
import { listWorkflowVersions } from '@/lib/workflows/application/list-workflow-versions'
import { readWorkflow, readWorkflowMetadata } from '@/lib/workflows/application/read-workflow'
import { readWorkflowVersion } from '@/lib/workflows/application/read-workflow-version'
import { updateWorkflow } from '@/lib/workflows/application/update-workflow'

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
const personalPrincipal = {
  kind: 'personal_api_key' as const,
  userId: 'user-1',
  keyId: 'personal-key-1',
}
const workspacePrincipal = {
  kind: 'workspace_api_key' as const,
  workspaceId: WORKSPACE_ID,
  keyId: 'workspace-key-1',
}
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
    vi.clearAllMocks()
    mocks.resolvePermission.mockResolvedValue('admin')
    mocks.resolveWorkspaceContext.mockResolvedValue(workspaceContext)
    mocks.resolveWorkflowContext.mockResolvedValue(workflowContext)
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
    mocks.loadNormalized.mockResolvedValue({
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
    mocks.listVersions.mockResolvedValue({ versions: [] })
    mocks.readVersion.mockResolvedValue({
      id: 'version-1',
      version: 1,
      name: null,
      description: null,
      isActive: true,
      createdAt: now,
      state: { blocks: {}, edges: [], loops: {}, parallels: {}, version: '1.0' },
    })
  })

  it('reads metadata through the shared read policy without loading the graph', async () => {
    mocks.folderPathForId.mockReturnValue('/Planning/Nested')
    const result = await readWorkflowMetadata.execute({
      principal: {
        kind: 'delegated',
        serviceId: 'copilot',
        subjectUserId: 'user-1',
        workspaceId: WORKSPACE_ID,
        delegationId: 'chat-read',
        audience: 'sim:workflows',
        issuedAt: now,
        expiresAt: new Date('2999-01-01'),
      },
      input: { workflowId: WORKFLOW_ID, assertedWorkspaceId: WORKSPACE_ID },
    })
    expect(result).toEqual({ workflow: workflowRecord, folderPath: '/Planning/Nested' })
    expect(mocks.resolveWorkflowContext).toHaveBeenCalledWith({
      workflowId: WORKFLOW_ID,
      assertedWorkspaceId: undefined,
    })
    expect(mocks.loadFolderIndex).toHaveBeenCalledWith(WORKSPACE_ID, 'workflow', undefined, {
      maxRows: MAX_FOLDERS_PER_WORKSPACE,
    })
    expect(mocks.loadSnapshot).not.toHaveBeenCalled()
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  it('refuses metadata to a removed member before resolving folder paths', async () => {
    mocks.resolvePermission.mockResolvedValue(null)
    await expect(
      readWorkflowMetadata.execute({
        principal: personalPrincipal,
        input: { workflowId: WORKFLOW_ID, assertedWorkspaceId: WORKSPACE_ID },
      })
    ).rejects.toThrow()
    expect(mocks.loadFolderIndex).not.toHaveBeenCalled()
    expect(mocks.loadSnapshot).not.toHaveBeenCalled()
  })

  it('creates for a personal key and projects one authoritative semantic audit', async () => {
    await expect(
      createWorkflow.execute({
        principal: personalPrincipal,
        input: { workspaceId: WORKSPACE_ID, name: workflowRecord.name },
      })
    ).resolves.toMatchObject({ workflow: { id: WORKFLOW_ID } })

    expect(mocks.createTransition).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', workspaceId: WORKSPACE_ID })
    )
    expect(mocks.recordAudit).toHaveBeenCalledTimes(1)
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'user-1',
        action: 'workflow.created',
        resourceId: WORKFLOW_ID,
        metadata: expect.objectContaining({
          operation: 'workflows.create',
          actor: expect.objectContaining({ kind: 'personal_api_key', keyId: 'personal-key-1' }),
        }),
      })
    )
    expect(mocks.notifyWorkflowUpdated).toHaveBeenCalledWith(WORKFLOW_ID)
    expect(mocks.notifyWorkspaceWorkflowsChanged).toHaveBeenCalledWith(WORKSPACE_ID)
    expect(mocks.workflowCreated).toHaveBeenCalledWith(
      expect.objectContaining({ workflowId: WORKFLOW_ID, workspaceId: WORKSPACE_ID })
    )
  })

  it('uses the billing owner only for the workspace key legacy user column', async () => {
    await createWorkflow.execute({
      principal: workspacePrincipal,
      input: { workspaceId: WORKSPACE_ID, name: workflowRecord.name },
    })

    expect(mocks.createTransition).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'billing-owner-1' })
    )
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: null,
        actorName: 'Workspace API key',
        metadata: expect.objectContaining({
          actor: {
            kind: 'workspace_api_key',
            keyId: 'workspace-key-1',
            workspaceId: WORKSPACE_ID,
          },
        }),
      })
    )
  })

  it('propagates infrastructure failure without projecting audit', async () => {
    const failure = new Error('database unavailable')
    mocks.createTransition.mockRejectedValue(failure)

    await expect(
      createWorkflow.execute({
        principal: workspacePrincipal,
        input: { workspaceId: WORKSPACE_ID, name: workflowRecord.name },
      })
    ).rejects.toBe(failure)
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  it('returns forbidden when a workspace key does not match canonical workflow scope', async () => {
    await expect(
      readWorkflow.execute({
        principal: { ...workspacePrincipal, workspaceId: 'workspace-other' },
        input: { workflowId: WORKFLOW_ID },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.resolveWorkflowContext).toHaveBeenCalledWith({
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
    expect(mocks.resolveWorkflowContext).not.toHaveBeenCalled()
    expect(mocks.updateRecord).not.toHaveBeenCalled()
  })

  it('allows executor reads only after canonical same-workspace binding and permission recheck', async () => {
    await readWorkflow.execute({
      principal: executorPrincipal,
      input: { workflowId: WORKFLOW_ID },
    })

    expect(mocks.resolveWorkflowContext).toHaveBeenCalledWith({
      workflowId: WORKFLOW_ID,
      assertedWorkspaceId: undefined,
    })
    expect(mocks.resolvePermission).toHaveBeenCalledWith('user-1', WORKSPACE_ID, null, undefined, {
      forUpdate: undefined,
    })
    expect(mocks.loadSnapshot).toHaveBeenCalledWith(WORKFLOW_ID, WORKSPACE_ID)
  })

  it('rejects executor reads whose canonical target is outside the signed origin workspace', async () => {
    mocks.resolveWorkflowContext.mockResolvedValueOnce({
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
    mocks.resolvePermission.mockResolvedValueOnce('write').mockResolvedValueOnce('read')

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

  it('does not audit an authoritative delete no-op', async () => {
    mocks.deleteRecord.mockResolvedValue({
      success: true,
      archived: false,
      workflow: { id: WORKFLOW_ID, name: workflowRecord.name, workspaceId: WORKSPACE_ID },
    })

    await deleteWorkflow.execute({
      principal: personalPrincipal,
      input: { workflowId: WORKFLOW_ID },
    })

    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  it('bounds both paginated and legacy unpaginated version listing', async () => {
    await listWorkflowVersions.execute({
      principal: workspacePrincipal,
      input: { workflowId: WORKFLOW_ID, limit: 50 },
    })
    expect(mocks.listVersions).toHaveBeenLastCalledWith(WORKFLOW_ID, {
      limit: 51,
      afterVersion: undefined,
    })

    await expect(
      listWorkflowVersions.execute({
        principal: workspacePrincipal,
        input: { workflowId: WORKFLOW_ID },
      })
    ).resolves.toEqual({ versions: [], hasMore: false })
    expect(mocks.listVersions).toHaveBeenLastCalledWith(WORKFLOW_ID, {
      limit: 1001,
      afterVersion: undefined,
    })

    mocks.listVersions.mockResolvedValue({
      versions: Array.from({ length: 1001 }, (_, index) => ({ id: `version-${index}` })),
    })
    await expect(
      listWorkflowVersions.execute({
        principal: workspacePrincipal,
        input: { workflowId: WORKFLOW_ID },
      })
    ).rejects.toThrow('Workflow version list exceeds the 1000 row limit')
  })

  it('reads one version only after canonical workflow authorization', async () => {
    await expect(
      readWorkflowVersion.execute({
        principal: personalPrincipal,
        input: { workflowId: WORKFLOW_ID, version: 1 },
      })
    ).resolves.toMatchObject({ version: { id: 'version-1', version: 1 } })
    expect(mocks.resolveWorkflowContext).toHaveBeenCalledBefore(mocks.readVersion)
  })
})
