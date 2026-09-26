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

import { deployWorkflowDeployment } from '@/lib/internal/deployments/client'

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
    for (const execute of Object.values(mocks)) execute.mockResolvedValue({})
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
