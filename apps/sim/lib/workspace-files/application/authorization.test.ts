/**
 * @vitest-environment node
 */
import type { Principal } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const resolvePermission = vi.hoisted(() => vi.fn())

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null, required: string) => {
    const rank = { read: 1, write: 2, admin: 3 } as const
    return (
      actual !== null && rank[actual as keyof typeof rank] >= rank[required as keyof typeof rank]
    )
  },
  resolveEffectiveWorkspacePermission: resolvePermission,
}))

import type { OrchestrationError } from '@/lib/core/orchestration/types'
import { authorizeWorkspaceFileAccess } from '@/lib/workspace-files/application/authorization'
import { fileOperations } from '@/lib/workspace-files/application/operations'

const authorizationContext = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: 'organization-1',
  allowPersonalApiKeys: true,
  fileId: 'file-1',
}

async function expectForbidden(principal: Principal) {
  await expect(
    authorizeWorkspaceFileAccess(principal, fileOperations.rename, authorizationContext)
  ).rejects.toMatchObject<Partial<OrchestrationError>>({ code: 'forbidden' })
}

describe('file operation authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resolvePermission.mockResolvedValue('write')
  })

  it('uses the current workspace permission for sessions', async () => {
    await authorizeWorkspaceFileAccess(
      { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      fileOperations.rename,
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

  it('rejects a reader for a write operation', async () => {
    resolvePermission.mockResolvedValue('read')
    await expectForbidden({ kind: 'session', userId: 'user-1', sessionId: 'session-1' })
  })

  it('lets a workspace key use its fixed write ceiling only in its own workspace', async () => {
    await authorizeWorkspaceFileAccess(
      { kind: 'workspace_api_key', workspaceId: 'workspace-1', keyId: 'key-1' },
      fileOperations.rename,
      authorizationContext
    )
    expect(resolvePermission).not.toHaveBeenCalled()

    await expectForbidden({
      kind: 'workspace_api_key',
      workspaceId: 'workspace-2',
      keyId: 'key-2',
    })
  })

  it('fails a personal key immediately when the workspace disables it', async () => {
    await expect(
      authorizeWorkspaceFileAccess(
        { kind: 'personal_api_key', userId: 'user-1', keyId: 'key-1' },
        fileOperations.rename,
        { ...authorizationContext, allowPersonalApiKeys: false }
      )
    ).rejects.toMatchObject<Partial<OrchestrationError>>({ code: 'forbidden' })
    expect(resolvePermission).not.toHaveBeenCalled()
  })

  it('rejects a disallowed principal kind before principal-specific authorization', async () => {
    await expect(
      authorizeWorkspaceFileAccess(
        { kind: 'personal_api_key', userId: 'user-1', keyId: 'key-1' },
        fileOperations.compiledCheck,
        { ...authorizationContext, allowPersonalApiKeys: false }
      )
    ).rejects.toMatchObject<Partial<OrchestrationError>>({
      code: 'forbidden',
      message: 'Principal kind personal_api_key cannot perform operation files.compiled_check',
    })
    expect(resolvePermission).not.toHaveBeenCalled()
  })

  it('reauthorizes a valid file-scoped Copilot delegation as its human subject', async () => {
    await authorizeWorkspaceFileAccess(
      {
        kind: 'delegated',
        serviceId: 'copilot',
        subjectUserId: 'user-1',
        workspaceId: 'workspace-1',
        delegationId: 'delegation-1',
        audience: 'sim:workspace-files',
        issuedAt: new Date(Date.now() - 1_000),
        expiresAt: new Date(Date.now() + 60_000),
        resourceScope: { fileId: 'file-1', chatId: 'chat-1' },
      },
      fileOperations.rename,
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

  it('admits executor delegation only for explicitly declared file-tool operations', async () => {
    const principal = {
      kind: 'delegated' as const,
      serviceId: 'executor' as const,
      subjectUserId: 'user-1',
      workspaceId: 'workspace-1',
      delegationId: 'delegation-1',
      audience: 'sim:workspace-files',
      issuedAt: new Date(Date.now() - 1_000),
      expiresAt: new Date(Date.now() + 60_000),
      resourceScope: { fileId: 'file-1', executionId: 'execution-1' },
    }

    await authorizeWorkspaceFileAccess(
      principal,
      fileOperations.updateContent,
      authorizationContext
    )
    expect(resolvePermission).toHaveBeenCalledTimes(1)

    resolvePermission.mockClear()
    await expect(
      authorizeWorkspaceFileAccess(principal, fileOperations.rename, authorizationContext)
    ).rejects.toMatchObject<Partial<OrchestrationError>>({
      code: 'forbidden',
      message: 'Delegated service executor cannot perform operation files.rename',
    })
    expect(resolvePermission).not.toHaveBeenCalled()
  })

  it('rejects expired or wrong-file delegations before permission lookup', async () => {
    const base = {
      kind: 'delegated' as const,
      serviceId: 'copilot' as const,
      subjectUserId: 'user-1',
      workspaceId: 'workspace-1',
      delegationId: 'delegation-1',
      audience: 'sim:workspace-files',
      issuedAt: new Date(Date.now() - 10_000),
    }

    await expectForbidden({
      ...base,
      expiresAt: new Date(Date.now() - 1),
      resourceScope: { fileId: 'file-1' },
    })
    await expectForbidden({
      ...base,
      expiresAt: new Date(Date.now() + 60_000),
      resourceScope: { fileId: 'file-2' },
    })
    expect(resolvePermission).not.toHaveBeenCalled()
  })
})
