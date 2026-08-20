/**
 * @vitest-environment node
 */
import { dbChainMockFns, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  loadActiveWorkspaceApplicationContext,
  loadWorkspaceApplicationContext,
  resolveActiveWorkspaceApplicationContext,
} from '@/lib/workspaces/application/workspace-context'

describe('loadActiveWorkspaceApplicationContext', () => {
  beforeEach(() => {
    resetDbChainMock()
  })

  it('returns canonical authorization and billing-attribution fields', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        id: 'workspace-1',
        organizationId: 'organization-1',
        allowPersonalApiKeys: true,
        billedAccountUserId: 'billing-owner-1',
      },
    ])

    await expect(loadActiveWorkspaceApplicationContext('workspace-1')).resolves.toEqual({
      workspaceId: 'workspace-1',
      workspaceOrganizationId: 'organization-1',
      allowPersonalApiKeys: true,
      billedAccountUserId: 'billing-owner-1',
    })
    expect(dbChainMockFns.from).toHaveBeenCalledWith(schemaMock.workspace)
  })

  it('returns null for an inactive or absent workspace', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([])

    await expect(loadActiveWorkspaceApplicationContext('workspace-1')).resolves.toBeNull()
  })

  it('can explicitly include archived workspaces', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        id: 'workspace-1',
        organizationId: null,
        allowPersonalApiKeys: false,
        billedAccountUserId: 'billing-owner-1',
      },
    ])

    await expect(
      loadWorkspaceApplicationContext('workspace-1', { includeArchived: true })
    ).resolves.toEqual({
      workspaceId: 'workspace-1',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: false,
      billedAccountUserId: 'billing-owner-1',
    })
  })

  it('propagates database failures', async () => {
    const failure = new Error('database unavailable')
    dbChainMockFns.limit.mockRejectedValueOnce(failure)

    await expect(loadActiveWorkspaceApplicationContext('workspace-1')).rejects.toBe(failure)
  })
})

describe('resolveActiveWorkspaceApplicationContext', () => {
  beforeEach(() => {
    resetDbChainMock()
  })

  it('returns the canonical context for an active workspace', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        id: 'workspace-1',
        organizationId: 'organization-1',
        allowPersonalApiKeys: true,
        billedAccountUserId: 'billing-owner-1',
      },
    ])

    await expect(resolveActiveWorkspaceApplicationContext('workspace-1')).resolves.toMatchObject({
      workspaceId: 'workspace-1',
    })
  })

  it('conceals an inactive or absent workspace as not found', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([])

    await expect(resolveActiveWorkspaceApplicationContext('workspace-1')).rejects.toMatchObject({
      code: 'not_found',
      message: 'Workspace not found',
    })
  })
})
