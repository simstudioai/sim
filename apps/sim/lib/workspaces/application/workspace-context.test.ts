import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  loadActiveWorkspaceApplicationContext,
  resolveActiveWorkspaceApplicationContext,
} from '@/lib/workspaces/application/workspace-context'

describe('loadActiveWorkspaceApplicationContext', () => {
  beforeEach(() => {
    resetDbChainMock()
  })

  it('returns null for an inactive or absent workspace', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([])

    await expect(loadActiveWorkspaceApplicationContext('workspace-1')).resolves.toBeNull()
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
