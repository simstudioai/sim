/** @vitest-environment node */
import { authMockFns, createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  role: vi.fn(),
  context: vi.fn(),
  manage: vi.fn(),
  eligible: vi.fn(),
  deployment: vi.fn(),
  list: vi.fn(),
  publish: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  usages: vi.fn(),
  audit: vi.fn(),
}))
vi.mock('@sim/platform-authz/workspace', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@sim/platform-authz/workspace')>()),
  resolveEffectiveWorkspacePermission: mocks.role,
}))
vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  resolveActiveWorkspaceApplicationContext: mocks.context,
}))
vi.mock('@/lib/workflows/custom-blocks/operations', () => ({
  CustomBlockValidationError: class extends Error {},
  getCustomBlockManageContext: mocks.manage,
  isCustomBlocksEligibleForOrganization: mocks.eligible,
  isCustomBlocksDeploymentEnabled: mocks.deployment,
  listCustomBlocksWithInputs: mocks.list,
  publishCustomBlock: mocks.publish,
  updateCustomBlock: mocks.update,
  deleteCustomBlock: mocks.remove,
  getCustomBlockUsageCounts: mocks.usages,
}))
vi.mock('@sim/audit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@sim/audit')>()),
  recordAudit: mocks.audit,
}))

import {
  deleteCustomBlockSettings,
  listCustomBlockSettings,
  publishCustomBlockSettings,
  readCustomBlockUsages,
  updateCustomBlockSettings,
} from '@/lib/workflows/custom-blocks/application/settings'
import { CustomBlockValidationError } from '@/lib/workflows/custom-blocks/operations'
import { DELETE as deleteRoute, PATCH as updateRoute } from '@/app/api/custom-blocks/[id]/route'
import { GET as listRoute, POST as publishRoute } from '@/app/api/custom-blocks/route'

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
    vi.clearAllMocks()
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'real-actor' },
      session: { id: 'session' },
    })
    mocks.role.mockResolvedValue('admin')
    mocks.context.mockImplementation(async (workspaceId: string) => ({
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

  it('lists the entitled organization catalog with read membership', async () => {
    mocks.role.mockResolvedValue('read')
    expect(
      await listCustomBlockSettings.execute({ principal, input: { workspaceId: 'source' } })
    ).toEqual({ enabled: true, customBlocks: [block] })
    expect(mocks.list).toHaveBeenCalledWith('org')
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
    expect(mocks.audit).toHaveBeenCalledWith(
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
    mocks.role.mockResolvedValue('write')
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

  it('updates from authoritative source workspace context and audits changes', async () => {
    await updateCustomBlockSettings.execute({
      principal,
      input: { ...target, patch: { name: 'Renamed', traceChildRuns: true } },
    })
    expect(mocks.update).toHaveBeenCalledWith('block', { name: 'Renamed', traceChildRuns: true })
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'real-actor',
        resourceName: 'Renamed',
        workspaceId: 'source',
      })
    )
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
    mocks.role.mockResolvedValue('read')
    await expect(readCustomBlockUsages.execute({ principal, input: target })).rejects.toThrow()
    expect(mocks.usages).not.toHaveBeenCalled()
  })

  it('reads usage counts and records deletion impact before removing the block', async () => {
    expect(await readCustomBlockUsages.execute({ principal, input: target })).toEqual({
      usageCount: 3,
      deployedUsageCount: 2,
    })
    expect(await deleteCustomBlockSettings.execute({ principal, input: target })).toEqual({
      success: true,
      usageCount: 3,
      deployedUsageCount: 2,
    })
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith('block')
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ usageCount: 3, deployedUsageCount: 2 }),
      })
    )
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
  it('keeps UI list and publish response contracts while sharing the application boundary', async () => {
    const listing = await listRoute(
      createMockRequest(
        'GET',
        undefined,
        undefined,
        'http://localhost:3000/api/custom-blocks?workspaceId=source'
      )
    )
    expect(listing.status).toBe(200)
    expect(await listing.json()).toEqual({ enabled: true, customBlocks: [block] })
    const published = await publishRoute(createMockRequest('POST', publishInput))
    expect(published.status).toBe(200)
    expect(await published.json()).toEqual({ customBlock: block })
  })

  it('keeps UI update/delete responses and rejects invalid updates before mutation', async () => {
    const routeContext = { params: Promise.resolve({ id: 'block' }) }
    const updated = await updateRoute(createMockRequest('PATCH', { enabled: false }), routeContext)
    expect(updated.status).toBe(200)
    expect(await updated.json()).toEqual({ success: true })
    const invalid = await updateRoute(
      createMockRequest('PATCH', { exposedOutputs: [] }),
      routeContext
    )
    expect(invalid.status).toBe(400)
    expect(mocks.update).toHaveBeenCalledTimes(1)
    const removed = await deleteRoute(createMockRequest('DELETE'), routeContext)
    expect(removed.status).toBe(200)
    expect(await removed.json()).toEqual({ success: true })
  })
  it('preserves actionable domain validation errors for both adapters without auditing failed mutations', async () => {
    mocks.publish.mockRejectedValueOnce(new CustomBlockValidationError('Workflow is not deployed'))
    await expect(
      publishCustomBlockSettings.execute({ principal, input: publishInput })
    ).rejects.toMatchObject({ code: 'validation', message: 'Workflow is not deployed' })
    expect(mocks.audit).not.toHaveBeenCalled()
  })
})
