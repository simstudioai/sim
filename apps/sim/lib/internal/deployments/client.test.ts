/**
 * @vitest-environment node
 */
import type { DelegatedPrincipal } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  activate: vi.fn(),
  deploy: vi.fn(),
  getVersion: vi.fn(),
  listVersions: vi.fn(),
  undeploy: vi.fn(),
}))

vi.mock('@/lib/workflows/application/deployments', () => ({
  activateWorkflowVersion: { execute: mocks.activate },
  deployWorkflow: { execute: mocks.deploy },
  undeployWorkflow: { execute: mocks.undeploy },
}))

vi.mock('@/lib/workflows/application/list-workflow-versions', () => ({
  listWorkflowVersions: { execute: mocks.listVersions },
}))

vi.mock('@/lib/workflows/application/read-workflow-version', () => ({
  readWorkflowVersion: { execute: mocks.getVersion },
}))

import {
  deployWorkflowDeployment,
  getWorkflowDeploymentVersion,
  listWorkflowDeploymentVersions,
  promoteWorkflowDeployment,
  undeployWorkflowDeployment,
} from '@/lib/internal/deployments/client'

const principal: DelegatedPrincipal = {
  kind: 'delegated',
  serviceId: 'executor',
  subjectUserId: 'user-1',
  workspaceId: 'workspace-1',
  delegationId: 'delegation-1',
  audience: 'sim:workflows',
  issuedAt: new Date('2026-01-01T00:00:00Z'),
  expiresAt: new Date('2026-01-01T00:05:00Z'),
}

const context = { principal, requestId: 'request-1' }

describe('deployment application client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const execute of Object.values(mocks)) execute.mockResolvedValue({})
  })

  it('uses the authorized deployment use cases for mutations', async () => {
    await deployWorkflowDeployment(
      {
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        name: 'Release 4',
        description: 'Fixes the agent prompt',
      },
      context
    )
    await undeployWorkflowDeployment(
      { workflowId: 'workflow-1', workspaceId: 'workspace-1' },
      context
    )
    await promoteWorkflowDeployment(
      { workflowId: 'workflow-1', workspaceId: 'workspace-1', version: 3 },
      context
    )

    expect(mocks.deploy).toHaveBeenCalledWith({
      principal,
      input: {
        workflowId: 'workflow-1',
        assertedWorkspaceId: 'workspace-1',
        name: 'Release 4',
        description: 'Fixes the agent prompt',
        requestId: 'request-1',
        idempotencyKey: 'request-1',
      },
    })
    expect(mocks.undeploy).toHaveBeenCalledWith({
      principal,
      input: {
        workflowId: 'workflow-1',
        assertedWorkspaceId: 'workspace-1',
        requestId: 'request-1',
      },
    })
    expect(mocks.activate).toHaveBeenCalledWith({
      principal,
      input: {
        workflowId: 'workflow-1',
        assertedWorkspaceId: 'workspace-1',
        version: 3,
        transition: 'activate',
        requestId: 'request-1',
        idempotencyKey: 'request-1',
      },
    })
  })

  it('uses bounded and credential-sanitizing application reads', async () => {
    await listWorkflowDeploymentVersions(
      { workflowId: 'workflow-1', workspaceId: 'workspace-1' },
      context
    )
    await getWorkflowDeploymentVersion(
      { workflowId: 'workflow-1', workspaceId: 'workspace-1', version: 3 },
      context
    )

    expect(mocks.listVersions).toHaveBeenCalledWith({
      principal,
      input: { workflowId: 'workflow-1', assertedWorkspaceId: 'workspace-1' },
    })
    expect(mocks.getVersion).toHaveBeenCalledWith({
      principal,
      input: {
        workflowId: 'workflow-1',
        assertedWorkspaceId: 'workspace-1',
        version: 3,
      },
    })
  })

  it('does not start application work after cancellation', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))

    await expect(
      deployWorkflowDeployment(
        { workflowId: 'workflow-1', workspaceId: 'workspace-1' },
        { ...context, signal: controller.signal }
      )
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.deploy).not.toHaveBeenCalled()
  })

  it('returns a committed mutation result when cancellation arrives after the use case succeeds', async () => {
    const controller = new AbortController()
    const committed = { activeDeployment: { id: 'deployment-1' } }
    mocks.deploy.mockImplementationOnce(async () => {
      controller.abort(new DOMException('cancelled', 'AbortError'))
      return committed
    })

    await expect(
      deployWorkflowDeployment(
        { workflowId: 'workflow-1', workspaceId: 'workspace-1' },
        { ...context, signal: controller.signal }
      )
    ).resolves.toBe(committed)
  })
})
