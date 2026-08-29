/**
 * @vitest-environment node
 */
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
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
  deployTableWorkflow,
  parseTableWorkflowDeploymentBackfillArgs,
  postgresTableWorkflowDeploymentStore,
  prepareTableWorkflowDeploymentBackfillEnvironment,
  TABLE_WORKFLOW_DEPLOYMENT_BATCH_SIZE,
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
    vi.clearAllMocks()
    resetDbChainMock()
  })

  afterEach(() => {
    restoreEnvironmentVariable('DATABASE_URL')
    restoreEnvironmentVariable('DATABASE_URL_WEB')
    restoreEnvironmentVariable('REDIS_TLS_SERVERNAME')
    restoreEnvironmentVariable('REDIS_URL')
    restoreEnvironmentVariable('SIM_ENV_SECRET_ID')
  })

  it('loads the staging runtime secret before database modules are needed', async () => {
    Reflect.deleteProperty(process.env, 'DATABASE_URL')
    Reflect.deleteProperty(process.env, 'DATABASE_URL_WEB')
    Reflect.deleteProperty(process.env, 'REDIS_TLS_SERVERNAME')
    Reflect.deleteProperty(process.env, 'REDIS_URL')
    Reflect.deleteProperty(process.env, 'SIM_ENV_SECRET_ID')
    mockLoadRuntimeSecrets.mockImplementation(async () => {
      process.env.DATABASE_URL = 'postgres://staging/database'
      process.env.REDIS_TLS_SERVERNAME = 'cache.staging.internal'
      process.env.REDIS_URL = 'rediss://cache.staging.internal:6379'
    })

    await prepareTableWorkflowDeploymentBackfillEnvironment(['--environment=staging'])

    expect(process.env.SIM_ENV_SECRET_ID).toBe('/staging/sim/env-vars')
    expect(process.env.REDIS_TLS_SERVERNAME).toBeUndefined()
    expect(process.env.REDIS_URL).toBeUndefined()
    expect(mockLoadRuntimeSecrets).toHaveBeenCalledTimes(1)
  })

  it('keeps the existing local DATABASE_URL mode when no environment is requested', async () => {
    process.env.DATABASE_URL = 'postgres://local/database'
    process.env.REDIS_URL = 'redis://localhost:6379'

    await prepareTableWorkflowDeploymentBackfillEnvironment([])

    expect(mockLoadRuntimeSecrets).not.toHaveBeenCalled()
    expect(process.env.DATABASE_URL).toBe('postgres://local/database')
    expect(process.env.REDIS_URL).toBe('redis://localhost:6379')
  })

  it('rejects unsupported, unknown, duplicate, and locally configured staging arguments', async () => {
    expect(() => parseTableWorkflowDeploymentBackfillArgs(['--environment=production'])).toThrow(
      'Unsupported backfill environment: production'
    )
    expect(() => parseTableWorkflowDeploymentBackfillArgs(['--dry-run'])).toThrow(
      'Unknown argument: --dry-run'
    )
    expect(() =>
      parseTableWorkflowDeploymentBackfillArgs(['--environment=staging', '--environment=staging'])
    ).toThrow('can only be provided once')

    process.env.DATABASE_URL = 'postgres://local/database'
    await expect(
      prepareTableWorkflowDeploymentBackfillEnvironment(['--environment=staging'])
    ).rejects.toThrow('local configuration cannot override staging')
    expect(mockLoadRuntimeSecrets).not.toHaveBeenCalled()
  })

  it('silently excludes missing and archived workflow references from integrity checks', async () => {
    await postgresTableWorkflowDeploymentStore.assertIntegrity()

    const referenceQuery = dbChainMockFns.execute.mock.calls[2]?.[0] as MockSqlQuery
    const queryText = referenceQuery.toSQL().sql
    expect(queryText).toContain('INNER JOIN workflow')
    expect(queryText).toContain('workflow.archived_at IS NULL')
    expect(queryText).not.toContain('LEFT JOIN workflow')
    expect(queryText).not.toContain('workflow.id IS NULL')
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
