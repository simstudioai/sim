/**
 * @vitest-environment node
 */

import { auditMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionContext } from '@/lib/copilot/request/types'

const {
  ensureWorkflowAccessMock,
  getWorkspaceWithOwnerMock,
  isFeatureEnabledMock,
  isOrganizationOnEnterprisePlanMock,
  publishCustomBlockMock,
  updateCustomBlockMock,
  deleteCustomBlockMock,
  getCustomBlockWithInputsByWorkflowIdMock,
  listWorkspaceFilesMock,
  fetchWorkspaceFileBufferMock,
  uploadFileMock,
} = vi.hoisted(() => ({
  ensureWorkflowAccessMock: vi.fn(),
  getWorkspaceWithOwnerMock: vi.fn(),
  isFeatureEnabledMock: vi.fn(),
  isOrganizationOnEnterprisePlanMock: vi.fn(),
  publishCustomBlockMock: vi.fn(),
  updateCustomBlockMock: vi.fn(),
  deleteCustomBlockMock: vi.fn(),
  getCustomBlockWithInputsByWorkflowIdMock: vi.fn(),
  listWorkspaceFilesMock: vi.fn(),
  fetchWorkspaceFileBufferMock: vi.fn(),
  uploadFileMock: vi.fn(),
}))

vi.mock('@sim/audit', () => auditMock)

vi.mock('../access', () => ({
  ensureWorkflowAccess: ensureWorkflowAccessMock,
  ensureWorkspaceAccess: vi.fn(),
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getWorkspaceWithOwner: getWorkspaceWithOwnerMock,
}))

vi.mock('@/lib/core/config/feature-flags', () => ({
  isFeatureEnabled: isFeatureEnabledMock,
}))

vi.mock('@/lib/billing', () => ({
  isOrganizationOnEnterprisePlan: isOrganizationOnEnterprisePlanMock,
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  listWorkspaceFiles: listWorkspaceFilesMock,
  fetchWorkspaceFileBuffer: fetchWorkspaceFileBufferMock,
}))

vi.mock('@/lib/uploads/core/storage-service', () => ({
  uploadFile: uploadFileMock,
}))

vi.mock('@/lib/uploads/utils/file-utils', () => ({
  isImageFileType: (type: string) => type.startsWith('image/'),
}))

vi.mock('@/lib/workflows/custom-blocks/operations', () => {
  class CustomBlockValidationError extends Error {}
  return {
    CustomBlockValidationError,
    publishCustomBlock: publishCustomBlockMock,
    updateCustomBlock: updateCustomBlockMock,
    deleteCustomBlock: deleteCustomBlockMock,
    getCustomBlockWithInputsByWorkflowId: getCustomBlockWithInputsByWorkflowIdMock,
  }
})

import { executeDeployCustomBlock } from './custom-block'

const context = { userId: 'user-1', workflowId: 'wf-1' } as ExecutionContext

const publishedBlock = {
  id: 'cb-1',
  organizationId: 'org-1',
  workflowId: 'wf-1',
  workflowName: 'Test Workflow',
  workspaceId: 'ws-1',
  workspaceName: 'Workspace',
  type: 'custom_block_abc123',
  name: 'Enrich Lead',
  description: 'Enrich a lead by email',
  iconUrl: null,
  enabled: true,
  inputFields: [{ id: 'f1', name: 'email', type: 'string' }],
  exposedOutputs: [{ blockId: 'b1', path: 'content', name: 'summary' }],
}

describe('executeDeployCustomBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ensureWorkflowAccessMock.mockResolvedValue({
      workflow: { id: 'wf-1', workspaceId: 'ws-1', name: 'Test Workflow', isDeployed: true },
    })
    getWorkspaceWithOwnerMock.mockResolvedValue({ id: 'ws-1', organizationId: 'org-1' })
    isFeatureEnabledMock.mockResolvedValue(true)
    isOrganizationOnEnterprisePlanMock.mockResolvedValue(true)
    getCustomBlockWithInputsByWorkflowIdMock.mockResolvedValue(null)
  })

  it('publishes a new custom block', async () => {
    publishCustomBlockMock.mockResolvedValue(publishedBlock)

    const result = await executeDeployCustomBlock(
      {
        name: 'Enrich Lead',
        description: 'Enrich a lead by email',
        exposedOutputs: [{ blockId: 'b1', path: 'content', name: 'summary' }],
      },
      context
    )

    expect(ensureWorkflowAccessMock).toHaveBeenCalledWith('wf-1', 'user-1', 'admin')
    expect(publishCustomBlockMock).toHaveBeenCalledWith({
      organizationId: 'org-1',
      workspaceId: 'ws-1',
      workflowId: 'wf-1',
      userId: 'user-1',
      name: 'Enrich Lead',
      description: 'Enrich a lead by email',
      iconUrl: undefined,
      inputs: undefined,
      exposedOutputs: [{ blockId: 'b1', path: 'content', name: 'summary' }],
    })
    expect(result.success).toBe(true)
    expect(result.output).toMatchObject({
      workflowId: 'wf-1',
      blockType: 'custom_block_abc123',
      isDeployed: true,
      updated: false,
      deploymentType: 'custom_block',
      deploymentStatus: { customBlock: { isDeployed: true, name: 'Enrich Lead' } },
    })
  })

  it('returns a clean admin-permission error when workflow access is denied', async () => {
    ensureWorkflowAccessMock.mockRejectedValue(new Error('Unauthorized workflow access'))

    const result = await executeDeployCustomBlock({ name: 'Enrich Lead' }, context)

    expect(result.success).toBe(false)
    expect(result.error).toContain('admin permission')
    expect(publishCustomBlockMock).not.toHaveBeenCalled()
  })

  it('surfaces workflow-not-found from access resolution', async () => {
    ensureWorkflowAccessMock.mockRejectedValue(new Error('Workflow wf-1 not found'))

    const result = await executeDeployCustomBlock({ name: 'Enrich Lead' }, context)

    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })

  it('requires a name on first publish', async () => {
    const result = await executeDeployCustomBlock({}, context)

    expect(result.success).toBe(false)
    expect(result.error).toContain('name is required')
    expect(publishCustomBlockMock).not.toHaveBeenCalled()
  })

  it('requires the workflow to be deployed on first publish', async () => {
    ensureWorkflowAccessMock.mockResolvedValue({
      workflow: { id: 'wf-1', workspaceId: 'ws-1', name: 'Test Workflow', isDeployed: false },
    })

    const result = await executeDeployCustomBlock({ name: 'Enrich Lead' }, context)

    expect(result.success).toBe(false)
    expect(result.error).toContain('deploy_api')
    expect(publishCustomBlockMock).not.toHaveBeenCalled()
  })

  it('updates an existing block in place', async () => {
    getCustomBlockWithInputsByWorkflowIdMock
      .mockResolvedValueOnce(publishedBlock)
      .mockResolvedValueOnce({ ...publishedBlock, name: 'Enrich Lead v2' })

    const result = await executeDeployCustomBlock({ name: 'Enrich Lead v2' }, context)

    expect(updateCustomBlockMock).toHaveBeenCalledWith('cb-1', {
      name: 'Enrich Lead v2',
      description: undefined,
      iconUrl: undefined,
      inputs: undefined,
      exposedOutputs: undefined,
    })
    expect(publishCustomBlockMock).not.toHaveBeenCalled()
    expect(result.success).toBe(true)
    expect(result.output).toMatchObject({ updated: true, name: 'Enrich Lead v2' })
  })

  it('unpublishes the block on undeploy', async () => {
    getCustomBlockWithInputsByWorkflowIdMock.mockResolvedValue(publishedBlock)

    const result = await executeDeployCustomBlock({ action: 'undeploy' }, context)

    expect(deleteCustomBlockMock).toHaveBeenCalledWith('cb-1')
    expect(result.success).toBe(true)
    expect(result.output).toMatchObject({
      isDeployed: false,
      removed: true,
      action: 'undeploy',
      blockType: 'custom_block_abc123',
    })
  })

  it('updates an existing block without requiring the enterprise plan', async () => {
    isOrganizationOnEnterprisePlanMock.mockResolvedValue(false)
    getCustomBlockWithInputsByWorkflowIdMock
      .mockResolvedValueOnce(publishedBlock)
      .mockResolvedValueOnce(publishedBlock)

    const result = await executeDeployCustomBlock({ description: 'refreshed copy' }, context)

    expect(result.success).toBe(true)
    expect(updateCustomBlockMock).toHaveBeenCalled()
    expect(publishCustomBlockMock).not.toHaveBeenCalled()
  })

  it('undeploys without requiring the enterprise plan', async () => {
    isOrganizationOnEnterprisePlanMock.mockResolvedValue(false)
    getCustomBlockWithInputsByWorkflowIdMock.mockResolvedValue(publishedBlock)

    const result = await executeDeployCustomBlock({ action: 'undeploy' }, context)

    expect(result.success).toBe(true)
    expect(deleteCustomBlockMock).toHaveBeenCalledWith('cb-1')
  })

  it('does not clear the stored name when a republish sends whitespace', async () => {
    getCustomBlockWithInputsByWorkflowIdMock
      .mockResolvedValueOnce(publishedBlock)
      .mockResolvedValueOnce(publishedBlock)

    const result = await executeDeployCustomBlock({ name: '   ' }, context)

    expect(updateCustomBlockMock).toHaveBeenCalledWith(
      'cb-1',
      expect.objectContaining({ name: undefined })
    )
    expect(result.success).toBe(true)
  })

  it('rejects oversized exposedOutputs and inputs arrays', async () => {
    const outputs = Array.from({ length: 51 }, (_, i) => ({
      blockId: `b${i}`,
      path: 'content',
      name: `out${i}`,
    }))
    const tooManyOutputs = await executeDeployCustomBlock(
      { name: 'Enrich Lead', exposedOutputs: outputs },
      context
    )
    expect(tooManyOutputs.success).toBe(false)
    expect(tooManyOutputs.error).toContain('50')

    const inputs = Array.from({ length: 51 }, (_, i) => ({ id: `f${i}` }))
    const tooManyInputs = await executeDeployCustomBlock({ name: 'Enrich Lead', inputs }, context)
    expect(tooManyInputs.success).toBe(false)
    expect(tooManyInputs.error).toContain('50')
    expect(publishCustomBlockMock).not.toHaveBeenCalled()
  })

  it('rejects oversized per-item fields', async () => {
    const longPlaceholder = await executeDeployCustomBlock(
      { name: 'Enrich Lead', inputs: [{ id: 'f1', placeholder: 'x'.repeat(201) }] },
      context
    )
    expect(longPlaceholder.success).toBe(false)
    expect(longPlaceholder.error).toContain('200')

    const longOutputName = await executeDeployCustomBlock(
      {
        name: 'Enrich Lead',
        exposedOutputs: [{ blockId: 'b1', path: 'content', name: 'x'.repeat(61) }],
      },
      context
    )
    expect(longOutputName.success).toBe(false)
    expect(longOutputName.error).toContain('60')
    expect(publishCustomBlockMock).not.toHaveBeenCalled()
  })

  it('rejects exposedOutputs entries missing required fields', async () => {
    const result = await executeDeployCustomBlock(
      { name: 'Enrich Lead', exposedOutputs: [{ blockId: 'b1', path: '', name: 'out' }] },
      context
    )
    expect(result.success).toBe(false)
    expect(result.error).toContain('blockId, path, and name')
  })

  it('fails undeploy when the workflow is not published as a block', async () => {
    const result = await executeDeployCustomBlock({ action: 'undeploy' }, context)

    expect(result.success).toBe(false)
    expect(deleteCustomBlockMock).not.toHaveBeenCalled()
  })

  it('fails when the feature flag is off', async () => {
    isFeatureEnabledMock.mockResolvedValue(false)

    const result = await executeDeployCustomBlock({ name: 'Enrich Lead' }, context)

    expect(result.success).toBe(false)
    expect(result.error).toContain('not enabled')
  })

  it('fails when the org is not on the enterprise plan', async () => {
    isOrganizationOnEnterprisePlanMock.mockResolvedValue(false)

    const result = await executeDeployCustomBlock({ name: 'Enrich Lead' }, context)

    expect(result.success).toBe(false)
    expect(result.error).toContain('enterprise')
  })

  it('ingests a workspace-file icon into public icon storage', async () => {
    listWorkspaceFilesMock.mockResolvedValue([
      {
        name: 'icon.png',
        folderPath: null,
        type: 'image/png',
        size: 1024,
        key: 'workspace/ws-1/123-abc-icon.png',
      },
    ])
    fetchWorkspaceFileBufferMock.mockResolvedValue(Buffer.from('png-bytes'))
    uploadFileMock.mockResolvedValue({ path: '/api/files/serve/s3/workspace-logos%2Ficon.png' })
    publishCustomBlockMock.mockResolvedValue(publishedBlock)

    const result = await executeDeployCustomBlock(
      { name: 'Enrich Lead', iconUrl: 'files/icon.png' },
      context
    )

    expect(uploadFileMock).toHaveBeenCalledWith(
      expect.objectContaining({
        context: 'workspace-logos',
        contentType: 'image/png',
        customKey: expect.stringMatching(/^workspace-logos\/\d+-[A-Za-z0-9_-]+-icon\.png$/),
        preserveKey: true,
        metadata: { workspaceId: 'ws-1', userId: 'user-1', originalName: 'icon.png' },
      })
    )
    expect(publishCustomBlockMock).toHaveBeenCalledWith(
      expect.objectContaining({ iconUrl: '/api/files/serve/s3/workspace-logos%2Ficon.png' })
    )
    expect(result.success).toBe(true)
  })

  it('passes an external icon URL through without ingestion', async () => {
    publishCustomBlockMock.mockResolvedValue(publishedBlock)

    const result = await executeDeployCustomBlock(
      { name: 'Enrich Lead', iconUrl: 'https://example.com/icon.png' },
      context
    )

    expect(uploadFileMock).not.toHaveBeenCalled()
    expect(publishCustomBlockMock).toHaveBeenCalledWith(
      expect.objectContaining({ iconUrl: 'https://example.com/icon.png' })
    )
    expect(result.success).toBe(true)
  })

  it('fails when the icon workspace file does not exist', async () => {
    listWorkspaceFilesMock.mockResolvedValue([])

    const result = await executeDeployCustomBlock(
      { name: 'Enrich Lead', iconUrl: 'files/missing.png' },
      context
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
    expect(publishCustomBlockMock).not.toHaveBeenCalled()
  })

  it('fails when the icon workspace file is not an image', async () => {
    listWorkspaceFilesMock.mockResolvedValue([
      { name: 'notes.pdf', folderPath: null, type: 'application/pdf', size: 1024, key: 'k' },
    ])

    const result = await executeDeployCustomBlock(
      { name: 'Enrich Lead', iconUrl: 'files/notes.pdf' },
      context
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('image')
    expect(uploadFileMock).not.toHaveBeenCalled()
  })

  it('fails when the workspace has no organization', async () => {
    getWorkspaceWithOwnerMock.mockResolvedValue({ id: 'ws-1', organizationId: null })

    const result = await executeDeployCustomBlock({ name: 'Enrich Lead' }, context)

    expect(result.success).toBe(false)
    expect(result.error).toContain('organization')
  })
})
