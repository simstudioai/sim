import { resetDbChainMock } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockLoadRuntimeSecrets, mockPerformFullDeploy } = vi.hoisted(() => ({
  mockLoadRuntimeSecrets: vi.fn(),
  mockPerformFullDeploy: vi.fn(),
}))

vi.mock('@sim/runtime-secrets', () => ({
  loadRuntimeSecrets: mockLoadRuntimeSecrets,
}))

vi.mock('@/lib/workflows/orchestration/deploy', () => ({
  performFullDeploy: mockPerformFullDeploy,
}))

import {
  backfillTableWorkflowDeployments,
  type TableWorkflowDeploymentCandidate,
  type TableWorkflowDeploymentStore,
} from '@/scripts/backfill-table-workflow-deployments'

const ORIGINAL_ENV = {
  DATABASE_URL: process.env.DATABASE_URL,
  DATABASE_URL_WEB: process.env.DATABASE_URL_WEB,
  REDIS_TLS_SERVERNAME: process.env.REDIS_TLS_SERVERNAME,
  REDIS_URL: process.env.REDIS_URL,
  SIM_ENV_SECRET_ID: process.env.SIM_ENV_SECRET_ID,
}

interface MockSqlQuery {
  toSQL(): { sql: string }
}

function restoreEnvironmentVariable(key: keyof typeof ORIGINAL_ENV): void {
  const value = ORIGINAL_ENV[key]
  if (value === undefined) {
    Reflect.deleteProperty(process.env, key)
  } else {
    process.env[key] = value
  }
}

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
    ...overrides,
  }
}

describe('backfillTableWorkflowDeployments', () => {
  beforeEach(() => {
    resetDbChainMock()
  })

  afterEach(() => {
    restoreEnvironmentVariable('DATABASE_URL')
    restoreEnvironmentVariable('DATABASE_URL_WEB')
    restoreEnvironmentVariable('REDIS_TLS_SERVERNAME')
    restoreEnvironmentVariable('REDIS_URL')
    restoreEnvironmentVariable('SIM_ENV_SECRET_ID')
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
    const backfillStore = store({ listCandidates, isDeployed })

    await expect(
      backfillTableWorkflowDeployments(backfillStore, deploy, { batchSize: 2 })
    ).resolves.toEqual({
      scanned: 3,
      deployed: 3,
      alreadyDeployed: 0,
      skippedLocked: 0,
      skippedUndeployable: 0,
    })
    expect(listCandidates.mock.calls).toEqual([
      ['', 2],
      ['workflow-b', 2],
      ['workflow-c', 2],
      ['', 1],
    ])
    expect(backfillStore.assertIntegrity).toHaveBeenCalledTimes(2)
    expect(deploy.mock.calls.map(([workflow]) => workflow.workflowId)).toEqual([
      'workflow-a',
      'workflow-b',
      'workflow-c',
    ])
  })

  it('reports and skips locked workflows while continuing the backfill', async () => {
    const listCandidates = vi
      .fn<TableWorkflowDeploymentStore['listCandidates']>()
      .mockResolvedValueOnce([candidate('workflow-a'), candidate('workflow-b')])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([candidate('workflow-a')])
      .mockResolvedValueOnce([])
    const deploymentState = new Map<string, boolean>()
    const isDeployed = vi
      .fn<TableWorkflowDeploymentStore['isDeployed']>()
      .mockImplementation(async (workflowId) => deploymentState.get(workflowId) ?? false)
    const deploy = vi.fn(async (workflow: TableWorkflowDeploymentCandidate) => {
      if (workflow.workflowId === 'workflow-a') {
        return {
          success: false,
          error: 'Workflow is locked by its containing folder',
          errorCode: 'locked' as const,
        }
      }
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

    await expect(
      backfillTableWorkflowDeployments(store({ listCandidates, isDeployed }), deploy)
    ).resolves.toEqual({
      scanned: 2,
      deployed: 1,
      alreadyDeployed: 0,
      skippedLocked: 1,
      skippedUndeployable: 0,
    })
    expect(deploy.mock.calls.map(([workflow]) => workflow.workflowId)).toEqual([
      'workflow-a',
      'workflow-b',
    ])
    expect(listCandidates.mock.calls.slice(-2)).toEqual([
      ['', 1],
      ['workflow-a', 1],
    ])
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
})
