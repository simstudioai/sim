import { environmentUtilsMockFns, resetEnvironmentUtilsMock } from '@sim/testing'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { permissionCheckMock } from '@sim/testing/mocks/permission-check.mock'
import { publicSharesMock, publicSharesMockFns } from '@sim/testing/mocks/public-shares.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceFileManagerMock,
  workspaceFileManagerMockFns,
} from '@sim/testing/mocks/workspace-file-manager.mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

vi.mock('@/lib/public-shares/share-manager', () => publicSharesMock)

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => workspaceFileManagerMock)

vi.mock('@/ee/access-control/utils/permission-check', () => permissionCheckMock)

import type { ShareAuthType } from '@/lib/api/contracts/public-shares'
import { markCopilotWorkspaceInvocation } from '@/lib/core/application/copilot-workspace-invocation'
import { createCopilotChatPrincipal } from '@/lib/mothership/auth/application-delegation'
import { WORKSPACE_FILES_DELEGATION_AUDIENCE } from '@/lib/workspace-files/application/authorization'
import {
  getWorkspaceFileShares,
  updateWorkspaceFileShare,
} from '@/lib/workspace-files/application/share-workspace-file'
import { MAX_WORKSPACE_FILE_BULK_AFFECTED_ITEMS } from '@/lib/workspace-files/limits'

const mocks = {
  getWorkspaceFile: workspaceFileManagerMockFns.mockGetWorkspaceFile,
  loadWorkspace: workspaceFileManagerMockFns.mockLoadActiveWorkspaceContext,
  loadFileContext: workspaceFileManagerMockFns.mockLoadActiveWorkspaceFileContext,
  getShare: publicSharesMockFns.mockGetShareForResource,
  getWorkspaceShares: publicSharesMockFns.mockGetWorkspaceSharesForResources,
  upsertFileShare: publicSharesMockFns.mockUpsertFileShare,
  resolvePermission: workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission,
}

const principal = createSessionPrincipal()

describe('getWorkspaceFileShares', () => {
  beforeEach(() => {
    mocks.resolvePermission.mockResolvedValue('read')
    mocks.loadWorkspace.mockResolvedValue({
      workspaceId: 'workspace-1',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'billing-owner',
    })
    mocks.getWorkspaceShares.mockResolvedValue(new Map())
  })

  it('deduplicates ids and constrains the batch lookup to the authorized workspace', async () => {
    await getWorkspaceFileShares.execute({
      principal,
      input: { workspaceId: 'workspace-1', fileIds: ['file-1', 'file-1', 'file-2'] },
    })

    expect(mocks.getWorkspaceShares).toHaveBeenCalledWith('file', 'workspace-1', [
      'file-1',
      'file-2',
    ])
  })

  it('refuses an oversized batch before querying shares', async () => {
    const fileIds = Array.from(
      { length: MAX_WORKSPACE_FILE_BULK_AFFECTED_ITEMS + 1 },
      (_, index) => `file-${index}`
    )

    await expect(
      getWorkspaceFileShares.execute({
        principal,
        input: { workspaceId: 'workspace-1', fileIds },
      })
    ).rejects.toMatchObject({ code: 'payload_too_large' })

    expect(mocks.getWorkspaceShares).not.toHaveBeenCalled()
  })
})

describe('updateWorkspaceFileShare password references', () => {
  const workspaceContext = {
    workspaceId: 'workspace-1',
    workspaceOrganizationId: null,
    allowPersonalApiKeys: true,
    billedAccountUserId: 'billing-owner',
  }

  function copilotPrincipal() {
    const copilot = createCopilotChatPrincipal(
      { userId: 'user-1', workspaceId: 'workspace-1', chatId: 'chat-1' },
      WORKSPACE_FILES_DELEGATION_AUDIENCE
    )
    markCopilotWorkspaceInvocation(copilot)
    return copilot
  }

  function share(
    caller: Parameters<typeof updateWorkspaceFileShare.execute>[0]['principal'],
    password: string,
    { authType }: { authType?: ShareAuthType } = { authType: 'password' }
  ) {
    return updateWorkspaceFileShare.execute({
      principal: caller,
      input: {
        fileId: 'file-1',
        assertedWorkspaceId: 'workspace-1',
        isActive: true,
        authType,
        password,
      },
    })
  }

  function environment(variables: Record<string, string>) {
    environmentUtilsMockFns.mockResolveEffectiveEnvironmentVariables.mockResolvedValueOnce(
      Object.fromEntries(
        Object.entries(variables).map(([name, value]) => [
          name,
          { value, scope: 'workspace', visible: false },
        ])
      )
    )
  }

  beforeEach(() => {
    mocks.resolvePermission.mockResolvedValue('write')
    mocks.loadFileContext.mockResolvedValue({ ...workspaceContext, fileId: 'file-1' })
    mocks.getWorkspaceFile.mockResolvedValue({ id: 'file-1', name: 'report.pdf' })
    mocks.getShare.mockResolvedValue(null)
    mocks.upsertFileShare.mockResolvedValue({ id: 'share-1', isActive: true })
  })

  afterEach(resetEnvironmentUtilsMock)

  it("stores the value of the agent's referenced variable, not the placeholder", async () => {
    environment({ SHARE_PW: 'resolved-share-password' })

    await share(copilotPrincipal(), '{{SHARE_PW}}')

    expect(environmentUtilsMockFns.mockResolveEffectiveEnvironmentVariables).toHaveBeenCalledWith(
      'user-1',
      'workspace-1',
      ['SHARE_PW']
    )
    expect(mocks.upsertFileShare).toHaveBeenCalledWith(
      expect.objectContaining({ password: 'resolved-share-password' })
    )
  })

  it('refuses an unset variable by name', async () => {
    await expect(share(copilotPrincipal(), '{{SHARE_PW}}')).rejects.toMatchObject({
      code: 'validation',
      message: expect.stringContaining('Environment variable "SHARE_PW"'),
    })
    expect(mocks.upsertFileShare).not.toHaveBeenCalled()
  })

  it('keeps a reference literal for any other caller, under the same rules', async () => {
    await expect(share(principal, '{{SHORT}}')).rejects.toMatchObject({
      code: 'validation',
      message: 'Password must be at least 15 characters',
    })
    expect(mocks.upsertFileShare).not.toHaveBeenCalled()

    await share(principal, '{{A_LONG_LITERAL_NAME}}')

    expect(mocks.upsertFileShare).toHaveBeenCalledWith(
      expect.objectContaining({ password: '{{A_LONG_LITERAL_NAME}}' })
    )
    expect(environmentUtilsMockFns.mockResolveEffectiveEnvironmentVariables).not.toHaveBeenCalled()
  })

  it('resolves only when the effective share mode is password', async () => {
    mocks.getShare.mockResolvedValue({ authType: 'email' })
    await share(copilotPrincipal(), '{{SHARE_PW}}', {})
    expect(environmentUtilsMockFns.mockResolveEffectiveEnvironmentVariables).not.toHaveBeenCalled()
    expect(mocks.upsertFileShare).toHaveBeenCalledWith(
      expect.objectContaining({ password: '{{SHARE_PW}}' })
    )

    mocks.getShare.mockResolvedValue({ authType: 'password' })
    environment({ SHARE_PW: 'resolved-share-password' })
    await share(copilotPrincipal(), '{{SHARE_PW}}', {})
    expect(mocks.upsertFileShare).toHaveBeenLastCalledWith(
      expect.objectContaining({ password: 'resolved-share-password' })
    )
  })
})
