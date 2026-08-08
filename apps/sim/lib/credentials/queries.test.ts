/**
 * @vitest-environment node
 */
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it } from 'vitest'
import { listWorkspacePrincipalCredentials } from '@/lib/credentials/queries'

describe('listWorkspacePrincipalCredentials', () => {
  beforeEach(() => {
    resetDbChainMock()
  })

  it('selects and returns only connection metadata', async () => {
    dbChainMockFns.orderBy.mockResolvedValueOnce([
      {
        id: 'credential-1',
        workspaceId: 'workspace-1',
        type: 'service_account',
        displayName: 'Zoom account',
        description: null,
        providerId: 'zoom-service-account',
        accountId: null,
        createdBy: 'user-1',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-02T00:00:00Z'),
        hasServiceAccountKey: true,
      },
    ])

    const result = await listWorkspacePrincipalCredentials({
      workspaceId: 'workspace-1',
      types: ['oauth', 'service_account'],
    })

    expect(result).toEqual([
      {
        id: 'credential-1',
        workspaceId: 'workspace-1',
        type: 'service_account',
        displayName: 'Zoom account',
        description: null,
        providerId: 'zoom-service-account',
        accountId: null,
        envKey: null,
        envOwnerUserId: null,
        createdBy: 'user-1',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-02T00:00:00Z'),
        hasServiceAccountKey: true,
        role: 'member',
      },
    ])
    expect(dbChainMockFns.select.mock.calls[0]?.[0]).not.toHaveProperty(
      'encryptedServiceAccountKey'
    )
  })

  it('fails fast on an empty connection-type policy', async () => {
    await expect(
      listWorkspacePrincipalCredentials({ workspaceId: 'workspace-1', types: [] })
    ).rejects.toThrow('Workspace credential types cannot be empty')
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })

  it('propagates database failures', async () => {
    const failure = new Error('database unavailable')
    dbChainMockFns.orderBy.mockRejectedValueOnce(failure)

    await expect(
      listWorkspacePrincipalCredentials({
        workspaceId: 'workspace-1',
        types: ['oauth', 'service_account'],
      })
    ).rejects.toBe(failure)
  })
})
