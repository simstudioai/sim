import type { Principal } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  permission: vi.fn(),
  fileContext: vi.fn(),
  workflowContext: vi.fn(),
  file: vi.fn(),
  share: vi.fn(),
  shareForResource: vi.fn(),
  access: vi.fn(),
}))
vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null, required: string) => {
    const rank: Record<string, number> = { read: 1, write: 2, admin: 3 }
    return actual !== null && rank[actual] >= rank[required]
  },
  resolveEffectiveWorkspacePermission: mocks.permission,
}))
vi.mock('@sim/db', () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: mocks.file }) }) }) },
}))
vi.mock('@/lib/workspace-files/application/workspace-file-context', () => ({
  resolveActiveWorkspaceFileContext: mocks.fileContext,
}))
vi.mock('@/lib/workflows/application/context', () => ({
  resolveActiveWorkflowApplicationContext: mocks.workflowContext,
}))
vi.mock('@/lib/public-shares/share-manager', () => ({
  resolveActiveShareByToken: mocks.share,
  getShareForResource: mocks.shareForResource,
}))
vi.mock('@/lib/workspace-files/workflows/execute', () => ({ accessFileWorkflow: mocks.access }))

import { authorizeFileWorkflowConfiguration } from '@/lib/workspace-files/application/file-workflow-policy'
import {
  accessSharedFileWorkflow,
  readFileWorkflow,
  runFileWorkflow,
  runSharedFileWorkflowAsMember,
} from '@/lib/workspace-files/application/file-workflows'

const principal = { kind: 'session' as const, userId: 'user-1', sessionId: 'session-1' }
const context = {
  fileId: 'file-1',
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner',
}
const file = {
  id: 'file-1',
  workspaceId: 'workspace-1',
  context: 'workspace',
  contentType: 'text/html',
  workflowIds: ['workflow-1'],
  workflowConfigVersion: 1,
}
const workflow = {
  ...context,
  workflowId: 'workflow-1',
  workflow: { id: 'workflow-1', workspaceId: 'workspace-1', isDeployed: true },
}
const share = {
  id: 'share-1',
  token: 'share-token',
  resourceId: 'file-1',
  workspaceId: 'workspace-1',
  updatedAt: new Date(),
  authType: 'public',
}
const input = { fileId: 'file-1', workflowId: 'workflow-1', assertedWorkspaceId: 'workspace-1' }

describe('file workflow application authority', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.permission.mockResolvedValue('read')
    mocks.fileContext.mockResolvedValue(context)
    mocks.file.mockResolvedValue([file])
    mocks.workflowContext.mockResolvedValue(workflow)
    mocks.share.mockResolvedValue({ file, share })
    mocks.shareForResource.mockResolvedValue({ ...share, isActive: true })
    mocks.access.mockImplementation(async (args) => {
      await args.reauthorize()
      return { status: 'empty' }
    })
  })

  it('preserves the human caller and asserts the canonical workspace for the workflow', async () => {
    await runFileWorkflow.execute({ principal, input })
    expect(mocks.access).toHaveBeenCalledWith(
      expect.objectContaining({ principal, userId: 'user-1', publicAccess: false })
    )
    expect(mocks.workflowContext).toHaveBeenCalledWith({
      workflowId: 'workflow-1',
      assertedWorkspaceId: 'workspace-1',
    })
  })

  it('allows an OAuth read scope to read results but not start workflows', async () => {
    const oauth: Principal = {
      kind: 'oauth_access_token',
      userId: 'user-1',
      clientId: 'client-1',
      tokenId: 'token-1',
      scopes: ['api:read'],
      expiresAt: new Date(Date.now() + 60_000),
    }
    await expect(readFileWorkflow.execute({ principal: oauth, input })).resolves.toEqual({
      status: 'empty',
    })
    await expect(runFileWorkflow.execute({ principal: oauth, input })).rejects.toMatchObject({
      code: 'forbidden',
    })
  })
  it.each([
    { ...file, contentType: 'text/plain' },
    { ...file, workflowIds: [] },
  ])('rejects calls outside HTML metadata', async (current) => {
    mocks.file.mockResolvedValue([current])
    await expect(runFileWorkflow.execute({ principal, input })).rejects.toMatchObject({
      code: 'not_found',
    })
    expect(mocks.access).not.toHaveBeenCalled()
  })
  it('rejects a caller whose workspace membership was revoked', async () => {
    mocks.permission.mockResolvedValue(null)
    await expect(runFileWorkflow.execute({ principal, input })).rejects.toMatchObject({
      code: 'forbidden',
    })
    expect(mocks.access).not.toHaveBeenCalled()
  })
  it('does not use the billing owner as the authority of a workspace key', async () => {
    const key = { kind: 'workspace_api_key' as const, workspaceId: 'workspace-1', keyId: 'key-1' }
    await runFileWorkflow.execute({ principal: key, input })
    expect(mocks.access).toHaveBeenCalledWith(expect.objectContaining({ principal: key }))
    const keyAudience = mocks.access.mock.calls[0][0].audience
    await runFileWorkflow.execute({ principal, input })
    expect(mocks.access.mock.calls[1][0].audience).not.toBe(keyAudience)
  })
  it('shares a user audience between a session and its file-scoped Copilot delegation', async () => {
    await readFileWorkflow.execute({ principal, input })
    const delegated: Principal = {
      kind: 'delegated',
      serviceId: 'copilot',
      subjectUserId: 'user-1',
      workspaceId: 'workspace-1',
      delegationId: 'delegation-1',
      audience: 'sim:workspace-files',
      issuedAt: new Date(Date.now() - 1000),
      expiresAt: new Date(Date.now() + 60_000),
      resourceScope: { fileId: 'file-1' },
    }
    await readFileWorkflow.execute({ principal: delegated, input })
    expect(mocks.access.mock.calls[0][0].audience).toBe(mocks.access.mock.calls[1][0].audience)
    await expect(
      runFileWorkflow.execute({
        principal: { ...delegated, resourceScope: { fileId: 'other-file' } },
        input,
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
  })
  it('lets an authorized member refresh the active public-share cache under public workflow authority', async () => {
    await runSharedFileWorkflowAsMember.execute({ principal, input })
    expect(mocks.shareForResource).toHaveBeenCalledWith('file', 'file-1')
    expect(mocks.access).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: {
          kind: 'system',
          serviceId: 'public_api',
          workspaceId: 'workspace-1',
          workflowId: 'workflow-1',
        },
        publicAccess: true,
        run: true,
      })
    )
    const memberAudience = mocks.access.mock.calls[0][0].audience
    await accessSharedFileWorkflow({
      token: share.token,
      workflowId: 'workflow-1',
      run: false,
      authenticateShare: async () => {},
    })
    expect(mocks.access.mock.calls[1][0].audience).toBe(memberAudience)
  })
  it('requires an active share before a member may refresh its cache', async () => {
    mocks.shareForResource.mockResolvedValue({ ...share, isActive: false })
    await expect(runSharedFileWorkflowAsMember.execute({ principal, input })).rejects.toMatchObject(
      {
        code: 'not_found',
      }
    )
    expect(mocks.access).not.toHaveBeenCalled()
  })
  it('rechecks member access when delivering a shared cache result', async () => {
    mocks.access.mockImplementation(async (args) => {
      mocks.permission.mockResolvedValue(null)
      await args.reauthorize()
    })
    await expect(runSharedFileWorkflowAsMember.execute({ principal, input })).rejects.toMatchObject(
      {
        code: 'forbidden',
      }
    )
  })
  it('requires publication authority to expose a configured workflow', async () => {
    const configuration = {
      principal,
      workspaceId: 'workspace-1',
      fileId: 'file-1',
      contentType: 'text/html',
      workflowIds: ['workflow-1'],
      publishing: true,
    }
    mocks.permission.mockResolvedValue('write')
    await expect(authorizeFileWorkflowConfiguration(configuration)).rejects.toMatchObject({
      code: 'forbidden',
    })
    mocks.permission.mockResolvedValue('admin')
    await expect(authorizeFileWorkflowConfiguration(configuration)).resolves.toBeUndefined()
  })
  it('does not admit a public request before the share authentication gate passes', async () => {
    await expect(
      accessSharedFileWorkflow({
        token: 'token',
        workflowId: 'workflow-1',
        run: true,
        authenticateShare: async () => {
          throw new Error('Password required')
        },
      })
    ).rejects.toThrow('Password required')
    expect(mocks.access).not.toHaveBeenCalled()
  })
  it('uses the workflow system principal for an authenticated shared-file call', async () => {
    const authenticateShare = vi.fn().mockResolvedValue(undefined)
    await accessSharedFileWorkflow({
      token: 'token',
      workflowId: 'workflow-1',
      run: true,
      authenticateShare,
    })
    expect(mocks.access).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: {
          kind: 'system',
          serviceId: 'public_api',
          workspaceId: 'workspace-1',
          workflowId: 'workflow-1',
        },
        publicAccess: true,
      })
    )
    expect(authenticateShare).toHaveBeenCalledTimes(2)
  })
  it('rejects a public result if share settings change during execution', async () => {
    mocks.share.mockResolvedValueOnce({ file, share }).mockResolvedValue({
      file,
      share: { ...share, updatedAt: new Date(share.updatedAt.getTime() + 1) },
    })
    await expect(
      accessSharedFileWorkflow({
        token: 'token',
        workflowId: 'workflow-1',
        run: true,
        authenticateShare: async () => {},
      })
    ).rejects.toMatchObject({ code: 'conflict' })
  })
})
