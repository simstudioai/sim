/**
 * @vitest-environment node
 */
import { dbChainMockFns, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  loadActiveWorkspaceApplicationContext,
  loadWorkspaceApplicationContext,
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
