import { authMockFns } from '@sim/testing'
import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import {
  customBlockOperationsMock,
  customBlockOperationsMockFns,
} from '@sim/testing/mocks/custom-block-operations.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceContextMock,
  workspaceContextMockFns,
} from '@sim/testing/mocks/workspace-context.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/workspaces/application/workspace-context', () => workspaceContextMock)
vi.mock('@/lib/workflows/custom-blocks/operations', () => customBlockOperationsMock)
vi.mock('@sim/audit', () => auditMock)

import {
  deleteCustomBlockSettings,
  listCustomBlockSettings,
  publishCustomBlockSettings,
  readCustomBlockUsages,
  updateCustomBlockSettings,
} from '@/lib/workflows/custom-blocks/application/settings'
import { CustomBlockValidationError } from '@/lib/workflows/custom-blocks/operations'

const mocks = {
  manage: customBlockOperationsMockFns.mockGetCustomBlockManageContext,
  eligible: customBlockOperationsMockFns.mockIsCustomBlocksEligibleForOrganization,
  deployment: customBlockOperationsMockFns.mockIsCustomBlocksDeploymentEnabled,
  list: customBlockOperationsMockFns.mockListCustomBlocksWithInputs,
  publish: customBlockOperationsMockFns.mockPublishCustomBlock,
  update: customBlockOperationsMockFns.mockUpdateCustomBlock,
  remove: customBlockOperationsMockFns.mockDeleteCustomBlock,
  usages: customBlockOperationsMockFns.mockGetCustomBlockUsageCounts,
}

const mockRole = workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission
const mockContext = workspaceContextMockFns.mockResolveActiveWorkspaceApplicationContext
const mockAudit = auditMockFns.mockRecordAudit

const principal = {
  kind: 'delegated',
  serviceId: 'copilot',
  subjectUserId: 'real-actor',
  workspaceId: 'source',
  audience: 'sim:settings',
  delegationId: 'call',
  issuedAt: new Date(),
  expiresAt: new Date(Date.now() + 60_000),
} as const
const target = { workspaceId: 'source', id: 'block' }
const publishInput = {
  workspaceId: 'source',
  workflowId: 'workflow',
  name: 'Published',
  exposedOutputs: [{ blockId: 'output', path: 'response', name: 'answer' }],
}
const block = {
  workflowName: 'Source',
  workspaceId: 'source',
  workspaceName: 'Source workspace',
  description: '',
  iconUrl: null,
  enabled: true,
  traceChildRuns: false,
  inputFields: [],
  exposedOutputs: publishInput.exposedOutputs,
  id: 'block',
  organizationId: 'org',
  workflowId: 'workflow',
  name: 'Published',
  type: 'custom_block',
}

describe('custom block settings boundary', () => {
  beforeEach(() => {
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'real-actor' },
      session: { id: 'session' },
    })
    mockRole.mockResolvedValue('admin')
    mockContext.mockImplementation(async (workspaceId: string) => ({
      workspaceId,
      workspaceOrganizationId: 'org',
      allowPersonalApiKeys: true,
    }))
    mocks.manage.mockResolvedValue({
      sourceWorkspaceId: 'source',
      organizationId: 'org',
      type: 'custom_block',
      name: 'Original',
    })
    mocks.eligible.mockResolvedValue(true)
    mocks.deployment.mockReturnValue(true)
    mocks.list.mockResolvedValue([block])
    mocks.publish.mockResolvedValue(block)
    mocks.usages.mockResolvedValue({ usageCount: 3, deployedUsageCount: 2 })
  })

  it('withholds the catalog when the organization is ineligible', async () => {
    mocks.eligible.mockResolvedValue(false)
    expect(
      await listCustomBlockSettings.execute({ principal, input: { workspaceId: 'source' } })
    ).toEqual({ enabled: false, customBlocks: [] })
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it('publishes as the real actor with private trace defaults and canonical organization', async () => {
    await publishCustomBlockSettings.execute({ principal, input: publishInput })
    expect(mocks.publish).toHaveBeenCalledWith({
      ...publishInput,
      organizationId: 'org',
      userId: 'real-actor',
      description: '',
      traceChildRuns: false,
    })
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'real-actor',
        workspaceId: 'source',
        resourceId: 'block',
        metadata: expect.objectContaining({ operation: 'custom_blocks.publish' }),
      })
    )
  })

  it('rejects publishing without entitlement or current source admin permission', async () => {
    mocks.eligible.mockResolvedValue(false)
    await expect(
      publishCustomBlockSettings.execute({ principal, input: publishInput })
    ).rejects.toThrow('not enabled')
    mockRole.mockResolvedValue('write')
    await expect(
      publishCustomBlockSettings.execute({ principal, input: publishInput })
    ).rejects.toThrow()
    expect(mocks.publish).not.toHaveBeenCalled()
  })

  it('enforces curated outputs and safe icons for direct application callers', async () => {
    await expect(
      publishCustomBlockSettings.execute({
        principal,
        input: { ...publishInput, exposedOutputs: [] },
      })
    ).rejects.toThrow()
    await expect(
      updateCustomBlockSettings.execute({
        principal,
        input: { ...target, patch: { iconUrl: 'javascript:alert(1)' } },
      })
    ).rejects.toThrow()
    await expect(
      updateCustomBlockSettings.execute({
        principal,
        input: {
          ...target,
          patch: { exposedOutputs: [{ blockId: 'x', path: 'x', name: 'cost' }] },
        },
      })
    ).rejects.toThrow()
    expect(mocks.publish).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('prevents an admin of another workspace from managing a discovered org-wide block', async () => {
    mocks.manage.mockResolvedValue({
      sourceWorkspaceId: 'other',
      organizationId: 'org',
      type: 'custom_block',
      name: 'Foreign',
    })
    await expect(
      updateCustomBlockSettings.execute({
        principal,
        input: { ...target, patch: { enabled: false } },
      })
    ).rejects.toThrow('another source workspace')
    await expect(
      deleteCustomBlockSettings.execute({ principal, input: { id: 'block', workspaceId: 'other' } })
    ).rejects.toThrow()
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.remove).not.toHaveBeenCalled()
  })

  it('requires explicit delegated target and current admin for usages', async () => {
    await expect(
      readCustomBlockUsages.execute({ principal, input: { id: 'block' } })
    ).rejects.toThrow('workspaceId')
    mockRole.mockResolvedValue('read')
    await expect(readCustomBlockUsages.execute({ principal, input: target })).rejects.toThrow()
    expect(mocks.usages).not.toHaveBeenCalled()
  })

  it('retains management after plan loss but requires the deployment feature', async () => {
    mocks.eligible.mockResolvedValue(false)
    await deleteCustomBlockSettings.execute({ principal, input: target })
    expect(mocks.eligible).not.toHaveBeenCalled()
    mocks.deployment.mockReturnValue(false)
    await expect(readCustomBlockUsages.execute({ principal, input: target })).rejects.toThrow(
      'not enabled'
    )
  })

  it('rejects deleted/moved resources and expired delegated authority', async () => {
    mocks.manage.mockResolvedValue(null)
    await expect(deleteCustomBlockSettings.execute({ principal, input: target })).rejects.toThrow(
      'Not found'
    )
    mocks.manage.mockResolvedValue({ sourceWorkspaceId: 'source', organizationId: 'old-org' })
    await expect(deleteCustomBlockSettings.execute({ principal, input: target })).rejects.toThrow(
      'Not found'
    )
    await expect(
      listCustomBlockSettings.execute({
        principal: { ...principal, expiresAt: new Date(0) },
        input: { workspaceId: 'source' },
      })
    ).rejects.toThrow()
    expect(mocks.remove).not.toHaveBeenCalled()
  })
  it('preserves actionable domain validation errors for both adapters without auditing failed mutations', async () => {
    mocks.publish.mockRejectedValueOnce(new CustomBlockValidationError('Workflow is not deployed'))
    await expect(
      publishCustomBlockSettings.execute({ principal, input: publishInput })
    ).rejects.toMatchObject({ code: 'validation', message: 'Workflow is not deployed' })
    expect(mockAudit).not.toHaveBeenCalled()
  })
})
