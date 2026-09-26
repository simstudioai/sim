import type { Principal } from '@sim/auth/principal'
import {
  createDelegatedPrincipal,
  createExecutorPrincipal,
  createPersonalApiKeyPrincipal,
  createSessionPrincipal,
  createWorkspaceApiKeyPrincipal,
} from '@sim/testing/factories/principal.factory'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

import type { OrchestrationError } from '@/lib/core/orchestration/types'
import { authorizeTableOperation } from '@/lib/table/application/authorization'
import { tableOperations } from '@/lib/table/application/operations'

const resolvePermission = workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission

const authorizationContext = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: 'organization-1',
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-user-1',
  tableId: 'table-1',
}

async function expectForbidden(principal: Principal) {
  await expect(
    authorizeTableOperation(principal, tableOperations.updateRow, authorizationContext)
  ).rejects.toMatchObject<Partial<OrchestrationError>>({ code: 'forbidden' })
}

describe('table operation authorization', () => {
  beforeEach(() => {
    resolvePermission.mockResolvedValue('write')
  })

  it('reauthorizes session and personal-key subjects against current policy', async () => {
    await authorizeTableOperation(
      createSessionPrincipal(),
      tableOperations.updateRow,
      authorizationContext
    )
    await authorizeTableOperation(
      createPersonalApiKeyPrincipal(),
      tableOperations.updateRow,
      authorizationContext
    )

    expect(resolvePermission).toHaveBeenCalledTimes(2)
    expect(resolvePermission).toHaveBeenNthCalledWith(
      1,
      'user-1',
      'workspace-1',
      'organization-1',
      undefined,
      { forUpdate: undefined }
    )
  })

  it('rejects a current reader for a write operation', async () => {
    resolvePermission.mockResolvedValue('read')

    await expectForbidden(createSessionPrincipal())
  })

  it('rejects disabled personal keys before permission lookup', async () => {
    await expect(
      authorizeTableOperation(createPersonalApiKeyPrincipal(), tableOperations.updateRow, {
        ...authorizationContext,
        allowPersonalApiKeys: false,
      })
    ).rejects.toMatchObject<Partial<OrchestrationError>>({ code: 'forbidden' })
    expect(resolvePermission).not.toHaveBeenCalled()
  })

  it('allows workspace keys only in their credential workspace', async () => {
    await authorizeTableOperation(
      createWorkspaceApiKeyPrincipal(),
      tableOperations.updateRow,
      authorizationContext
    )
    expect(resolvePermission).not.toHaveBeenCalled()

    await expectForbidden({
      kind: 'workspace_api_key',
      workspaceId: 'workspace-2',
      keyId: 'key-2',
    })
  })

  it('reauthorizes a valid table-scoped delegation as its human subject', async () => {
    await authorizeTableOperation(
      createDelegatedPrincipal({
        delegationId: 'tool-call-1',
        audience: 'sim:tables',
        resourceScope: { tableId: 'table-1', chatId: 'chat-1' },
      }),
      tableOperations.updateRow,
      authorizationContext
    )

    expect(resolvePermission).toHaveBeenCalledWith(
      'user-1',
      'workspace-1',
      'organization-1',
      undefined,
      { forUpdate: undefined }
    )
  })

  it('requires delegated scope to match the context in both directions', async () => {
    const unscopedPrincipal = createExecutorPrincipal({
      delegationId: 'execution-1',
      audience: 'sim:tables',
    })
    const workspaceContext = { ...authorizationContext, tableId: undefined }

    await authorizeTableOperation(unscopedPrincipal, tableOperations.readImport, workspaceContext)

    await expect(
      authorizeTableOperation(
        { ...unscopedPrincipal, resourceScope: { tableId: 'table-1' } },
        tableOperations.readImport,
        workspaceContext
      )
    ).rejects.toMatchObject<Partial<OrchestrationError>>({ code: 'forbidden' })
    await expect(
      authorizeTableOperation(unscopedPrincipal, tableOperations.read, authorizationContext)
    ).rejects.toMatchObject<Partial<OrchestrationError>>({ code: 'forbidden' })
  })

  it('rejects wrong-audience, expired, cross-workspace, unscoped, and wrong-table delegations before lookup', async () => {
    const base = {
      kind: 'delegated' as const,
      serviceId: 'copilot' as const,
      subjectUserId: 'user-1',
      workspaceId: 'workspace-1',
      delegationId: 'tool-call-1',
      audience: 'sim:tables',
      issuedAt: new Date(Date.now() - 10_000),
    }

    await expectForbidden({
      ...base,
      audience: 'sim:files',
      expiresAt: new Date(Date.now() + 60_000),
      resourceScope: { tableId: 'table-1' },
    })
    await expectForbidden({
      ...base,
      expiresAt: new Date(Date.now() - 1),
      resourceScope: { tableId: 'table-1' },
    })
    await expectForbidden({
      ...base,
      workspaceId: 'workspace-2',
      expiresAt: new Date(Date.now() + 60_000),
      resourceScope: { tableId: 'table-1' },
    })
    await expectForbidden({
      ...base,
      expiresAt: new Date(Date.now() + 60_000),
    })
    await expectForbidden({
      ...base,
      expiresAt: new Date(Date.now() + 60_000),
      resourceScope: { tableId: 'table-2' },
    })
    expect(resolvePermission).not.toHaveBeenCalled()
  })
})
