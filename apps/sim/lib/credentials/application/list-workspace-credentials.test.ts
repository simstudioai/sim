import {
  createSessionPrincipal,
  createWorkspaceApiKeyPrincipal,
} from '@sim/testing/factories/principal.factory'
import { auditMock } from '@sim/testing/mocks/audit.mock'
import { permissionsMock, permissionsMockFns } from '@sim/testing/mocks/permissions.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceContextMock,
  workspaceContextMockFns,
} from '@sim/testing/mocks/workspace-context.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  listVisible: vi.fn(),
  listForWorkspacePrincipal: vi.fn(),
}))

vi.mock('@/lib/workspaces/application/workspace-context', () => workspaceContextMock)

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

vi.mock('@/lib/credentials/queries', () => ({
  listVisibleWorkspaceCredentials: hoisted.listVisible,
  listWorkspacePrincipalCredentials: hoisted.listForWorkspacePrincipal,
}))

vi.mock('@sim/audit', () => auditMock)

import { listWorkspaceCredentials } from '@/lib/credentials/application/list-workspace-credentials'

const mocks = {
  ...hoisted,
  resolvePermission: workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission,
}

const workspaceContext = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}
const input = {
  workspaceId: 'workspace-1',
  sortBy: 'createdAt' as const,
  sortOrder: 'desc' as const,
}

describe('listWorkspaceCredentials', () => {
  beforeEach(() => {
    workspaceContextMockFns.mockLoadActiveWorkspaceApplicationContext.mockResolvedValue(
      workspaceContext
    )
    mocks.resolvePermission.mockResolvedValue('read')
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValue({
      hasAccess: true,
      canAdmin: false,
    })
    mocks.listVisible.mockResolvedValue({ data: [], nextCursorKeys: null })
    mocks.listForWorkspacePrincipal.mockResolvedValue({ data: [], nextCursorKeys: null })
  })

  it('preserves per-credential visibility for sessions', async () => {
    const principal = createSessionPrincipal()

    await listWorkspaceCredentials.execute({ principal, input })
    expect(mocks.listVisible).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', types: ['oauth', 'service_account'] })
    )
  })

  it('lists shared connections for a workspace key without creator identity', async () => {
    const principal = createWorkspaceApiKeyPrincipal()

    await listWorkspaceCredentials.execute({ principal, input })

    expect(mocks.listForWorkspacePrincipal).toHaveBeenCalledOnce()
    expect(permissionsMockFns.mockCheckWorkspaceAccess).not.toHaveBeenCalled()
    expect(mocks.listVisible).not.toHaveBeenCalled()
  })
})
