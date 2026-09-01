/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  deploy: vi.fn(),
  getVersion: vi.fn(),
  listVersions: vi.fn(),
  promote: vi.fn(),
  undeploy: vi.fn(),
}))

vi.mock('@/lib/internal/deployments/client', () => ({
  deployWorkflowDeployment: mocks.deploy,
  getWorkflowDeploymentVersion: mocks.getVersion,
  listWorkflowDeploymentVersions: mocks.listVersions,
  promoteWorkflowDeployment: mocks.promote,
  undeployWorkflowDeployment: mocks.undeploy,
}))

import {
  executeDeploymentsDeploy,
  executeDeploymentsGetVersion,
  executeDeploymentsListVersions,
  executeDeploymentsPromote,
  executeDeploymentsUndeploy,
} from '@/lib/internal/deployments/operations'

const context = {
  principal: {
    kind: 'delegated' as const,
    serviceId: 'executor' as const,
    subjectUserId: 'user-1',
    workspaceId: 'workspace-1',
    delegationId: 'delegation-1',
    audience: 'sim:workflows',
    issuedAt: new Date('2026-01-01T00:00:00Z'),
    expiresAt: new Date('2026-01-01T00:05:00Z'),
  },
  requestId: 'request-1',
}

describe('deployment tool operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('preserves deploy and promote result envelopes', async () => {
    const activeDeployment = { deploymentVersionId: 'version-3', version: 3 }
    mocks.deploy.mockResolvedValue({
      deployedAt: new Date('2026-06-12T00:00:00Z'),
      version: 3,
      activeDeployment,
      warnings: ['schedule sync pending'],
    })
    mocks.promote.mockResolvedValue({
      deployedAt: new Date('2026-06-13T00:00:00Z'),
      activeDeployment,
    })

    await expect(
      executeDeploymentsDeploy({ workflowId: 'workflow-1', workspaceId: 'workspace-1' }, context)
    ).resolves.toEqual({
      success: true,
      output: {
        workflowId: 'workflow-1',
        isDeployed: true,
        deployedAt: '2026-06-12T00:00:00.000Z',
        version: 3,
        activeDeployment,
        latestDeploymentAttempt: undefined,
        warnings: ['schedule sync pending'],
      },
    })
    await expect(
      executeDeploymentsPromote(
        { workflowId: 'workflow-1', workspaceId: 'workspace-1', version: 3 },
        context
      )
    ).resolves.toEqual({
      success: true,
      output: {
        workflowId: 'workflow-1',
        isDeployed: true,
        deployedAt: '2026-06-13T00:00:00.000Z',
        version: 3,
        activeDeployment,
        latestDeploymentAttempt: undefined,
        warnings: [],
      },
    })
  })

  it('preserves undeploy, list, and sanitized-version envelopes', async () => {
    const versions = [{ id: 'version-3', version: 3 }]
    const state = { blocks: {}, edges: [] }
    mocks.undeploy.mockResolvedValue({ warnings: [] })
    mocks.listVersions.mockResolvedValue({ versions })
    mocks.getVersion.mockResolvedValue({
      version: {
        version: 3,
        name: 'Release 3',
        description: null,
        isActive: false,
        createdAt: '2026-06-12T00:00:00.000Z',
        state,
      },
    })

    await expect(
      executeDeploymentsUndeploy({ workflowId: 'workflow-1', workspaceId: 'workspace-1' }, context)
    ).resolves.toEqual({
      success: true,
      output: {
        workflowId: 'workflow-1',
        isDeployed: false,
        deployedAt: null,
        warnings: [],
      },
    })
    await expect(
      executeDeploymentsListVersions(
        { workflowId: 'workflow-1', workspaceId: 'workspace-1' },
        context
      )
    ).resolves.toEqual({
      success: true,
      output: { workflowId: 'workflow-1', versions },
    })
    await expect(
      executeDeploymentsGetVersion(
        { workflowId: 'workflow-1', workspaceId: 'workspace-1', version: 3 },
        context
      )
    ).resolves.toEqual({
      success: true,
      output: {
        workflowId: 'workflow-1',
        version: 3,
        name: 'Release 3',
        description: null,
        isActive: false,
        createdAt: '2026-06-12T00:00:00.000Z',
        deployedState: state,
      },
    })
  })
})
