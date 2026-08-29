/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPerformFullDeploy } = vi.hoisted(() => ({
  mockPerformFullDeploy: vi.fn(),
}))

vi.mock('@/lib/workflows/orchestration/deploy', () => ({
  performFullDeploy: mockPerformFullDeploy,
}))

import {
  backfillTableWorkflowDeployments,
  deployTableWorkflow,
  TABLE_WORKFLOW_DEPLOYMENT_BATCH_SIZE,
  type TableWorkflowDeploymentCandidate,
  type TableWorkflowDeploymentStore,
} from '@/scripts/backfill-table-workflow-deployments'

function candidate(workflowId: string): TableWorkflowDeploymentCandidate {
  return {
    workflowId,
    workspaceId: 'workspace-1',
    userId: 'user-1',
  }
}

function store(
  overrides: Partial<TableWorkflowDeploymentStore> = {}
): TableWorkflowDeploymentStore {
  return {
    assertIntegrity: vi.fn().mockResolvedValue(undefined),
    listCandidates: vi.fn().mockResolvedValue([]),
    isDeployed: vi.fn().mockResolvedValue(false),
    pinActiveDeploymentVersions: vi.fn().mockResolvedValue(0),
    ...overrides,
  }
}

describe('backfillTableWorkflowDeployments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('deploys bounded keyset pages and verifies the final desired state', async () => {
    const listCandidates = vi
      .fn<TableWorkflowDeploymentStore['listCandidates']>()
      .mockResolvedValueOnce([candidate('workflow-a'), candidate('workflow-b')])
      .mockResolvedValueOnce([candidate('workflow-c')])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    const deploymentState = new Map<string, boolean>()
    const isDeployed = vi
      .fn<TableWorkflowDeploymentStore['isDeployed']>()
      .mockImplementation(async (workflowId) => deploymentState.get(workflowId) ?? false)
    const deploy = vi.fn(async (workflow: TableWorkflowDeploymentCandidate) => {
      deploymentState.set(workflow.workflowId, true)
      return {
        success: true,
        activeDeployment: {
          deploymentVersionId: `version-${workflow.workflowId}`,
          version: 1,
          deployedAt: new Date().toISOString(),
        },
      }
    })
    const pinActiveDeploymentVersions = vi.fn().mockResolvedValue(3)
    const backfillStore = store({ listCandidates, isDeployed, pinActiveDeploymentVersions })

    await expect(
      backfillTableWorkflowDeployments(backfillStore, deploy, { batchSize: 2 })
    ).resolves.toEqual({
      scanned: 3,
      deployed: 3,
      alreadyDeployed: 0,
      pinnedGroups: 3,
    })
    expect(listCandidates.mock.calls).toEqual([
      ['', 2],
      ['workflow-b', 2],
      ['workflow-c', 2],
      ['', 1],
    ])
    expect(backfillStore.assertIntegrity).toHaveBeenCalledTimes(2)
    expect(pinActiveDeploymentVersions).toHaveBeenCalledWith(2)
    expect(deploy.mock.calls.map(([workflow]) => workflow.workflowId)).toEqual([
      'workflow-a',
      'workflow-b',
      'workflow-c',
    ])
  })

  it('does not redeploy an already deployed workflow', async () => {
    const listCandidates = vi
      .fn<TableWorkflowDeploymentStore['listCandidates']>()
      .mockResolvedValueOnce([candidate('workflow-a')])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    const deploy = vi.fn()

    await expect(
      backfillTableWorkflowDeployments(
        store({
          listCandidates,
          isDeployed: vi.fn().mockResolvedValue(true),
        }),
        deploy
      )
    ).resolves.toEqual({
      scanned: 1,
      deployed: 0,
      alreadyDeployed: 1,
      pinnedGroups: 0,
    })
    expect(deploy).not.toHaveBeenCalled()
  })

  it('fails fast when canonical deployment fails', async () => {
    const listCandidates = vi
      .fn<TableWorkflowDeploymentStore['listCandidates']>()
      .mockResolvedValueOnce([candidate('workflow-a'), candidate('workflow-b')])
    const deploy = vi.fn().mockResolvedValue({
      success: false,
      error: 'invalid trigger configuration',
    })

    await expect(
      backfillTableWorkflowDeployments(store({ listCandidates }), deploy)
    ).rejects.toThrow('Failed to deploy table workflow workflow-a: invalid trigger configuration')
    expect(deploy).toHaveBeenCalledTimes(1)
  })

  it('fails when deployment does not activate or persist a valid active version', async () => {
    const firstList = vi
      .fn<TableWorkflowDeploymentStore['listCandidates']>()
      .mockResolvedValueOnce([candidate('workflow-a')])
    await expect(
      backfillTableWorkflowDeployments(store({ listCandidates: firstList }), async () => ({
        success: true,
        activeDeployment: null,
      }))
    ).rejects.toThrow('did not reach an active deployment state')

    const secondList = vi
      .fn<TableWorkflowDeploymentStore['listCandidates']>()
      .mockResolvedValueOnce([candidate('workflow-b')])
    await expect(
      backfillTableWorkflowDeployments(store({ listCandidates: secondList }), async () => ({
        success: true,
        activeDeployment: {
          deploymentVersionId: 'version-b',
          version: 1,
          deployedAt: new Date().toISOString(),
        },
      }))
    ).rejects.toThrow('completed without a valid active version')
  })

  it('rejects invalid batch and page behavior before it can loop or skip data', async () => {
    const invalidBatchStore = store()
    await expect(
      backfillTableWorkflowDeployments(invalidBatchStore, vi.fn(), { batchSize: 0 })
    ).rejects.toThrow('positive integer')
    expect(invalidBatchStore.assertIntegrity).not.toHaveBeenCalled()

    const oversizedStore = store({
      listCandidates: vi.fn().mockResolvedValue([candidate('workflow-a'), candidate('workflow-b')]),
    })
    await expect(
      backfillTableWorkflowDeployments(oversizedStore, vi.fn(), { batchSize: 1 })
    ).rejects.toThrow('oversized page')

    const duplicateStore = store({
      listCandidates: vi.fn().mockResolvedValue([candidate('workflow-a'), candidate('workflow-a')]),
    })
    await expect(
      backfillTableWorkflowDeployments(duplicateStore, vi.fn(), { batchSize: 2 })
    ).rejects.toThrow('duplicate workflow ids')
  })

  it('uses the canonical deployer with backfill attribution and a stable idempotency key', async () => {
    mockPerformFullDeploy.mockResolvedValue({
      success: true,
      activeDeployment: {
        deploymentVersionId: 'version-1',
        version: 1,
        deployedAt: new Date().toISOString(),
      },
    })

    await deployTableWorkflow(candidate('workflow-1'))

    expect(mockPerformFullDeploy).toHaveBeenCalledWith({
      workflowId: 'workflow-1',
      userId: 'user-1',
      actorId: 'table-workflow-deployment-backfill',
      captureAnalytics: false,
      requestId: 'table-workflow-deployment-backfill:v2:workflow-1',
      idempotencyKey: 'table-workflow-deployment-backfill:v2:workflow-1',
    })
  })

  it('uses the repository batch-size default', async () => {
    const listCandidates = vi.fn().mockResolvedValue([])

    await backfillTableWorkflowDeployments(store({ listCandidates }), vi.fn())

    expect(listCandidates).toHaveBeenNthCalledWith(1, '', TABLE_WORKFLOW_DEPLOYMENT_BATCH_SIZE)
  })
})
