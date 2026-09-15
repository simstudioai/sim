/** @vitest-environment node */
import type { DelegatedPrincipal, Principal } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  metadata: vi.fn(),
  workspace: vi.fn(),
  permission: vi.fn(),
}))

vi.mock('@/lib/uploads/server/metadata', () => ({ getFileMetadataByKey: mocks.metadata }))
vi.mock('@/lib/uploads/contexts/workspace', () => ({ loadActiveWorkspaceContext: mocks.workspace }))
vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (permission: string) => ['read', 'write', 'admin'].includes(permission),
  resolveEffectiveWorkspacePermission: mocks.permission,
}))

import { readStoredWorkspaceFileRecordByKey } from '@/lib/workspace-files/application/read-stored-workspace-file-record-by-key'

const input = {
  key: 'workspace/workspace-1/upload.png',
  assertedWorkspaceId: 'workspace-1',
}
const workspace = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner',
}
const file = {
  id: 'file-1',
  key: input.key,
  context: 'mothership',
  workspaceId: 'workspace-1',
  organizationId: null,
  chatId: 'chat-1',
  deletedAt: null,
  userId: 'uploader',
}
const session = { kind: 'session', userId: 'reader', sessionId: 'session-1' } as const

function executor(overrides: Partial<DelegatedPrincipal> = {}): DelegatedPrincipal {
  return {
    kind: 'delegated',
    serviceId: 'executor',
    workspaceId: workspace.workspaceId,
    delegationId: 'delegation-1',
    audience: 'sim:workspace-files',
    issuedAt: new Date(Date.now() - 1_000),
    expiresAt: new Date(Date.now() + 60_000),
    delegationContext: {
      kind: 'workflow_execution',
      workflowId: 'workflow-1',
      executionId: 'execution-1',
      principal: {
        kind: 'system',
        serviceId: 'chat',
        workspaceId: workspace.workspaceId,
        workflowId: 'workflow-1',
      },
      currentWorkflow: {
        workflowId: 'workflow-1',
        mode: 'deployment',
        deploymentVersionId: 'deployment-1',
      },
    },
    ...overrides,
  }
}

describe('readStoredWorkspaceFileRecordByKey', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.metadata.mockResolvedValue(file)
    mocks.workspace.mockResolvedValue(workspace)
    mocks.permission.mockResolvedValue('read')
  })

  it.each(['workspace', 'mothership'] as const)(
    'authorizes canonical %s bytes with the actual current workspace member',
    async (context) => {
      const record = { ...file, context }
      mocks.metadata.mockResolvedValue(record)

      await expect(
        readStoredWorkspaceFileRecordByKey.execute({ principal: session, input })
      ).resolves.toEqual({ file: record })
      expect(mocks.metadata).toHaveBeenCalledWith(input.key)
      expect(mocks.metadata).toHaveBeenNthCalledWith(1, input.key, undefined, {
        includeDeleted: true,
      })
      expect(mocks.metadata).toHaveBeenCalledTimes(2)
      expect(mocks.permission).toHaveBeenCalledWith('reader', 'workspace-1', null, undefined, {
        forUpdate: undefined,
      })
    }
  )

  it.each<Principal>([
    { kind: 'personal_api_key', userId: 'reader', keyId: 'key-1' },
    { kind: 'workspace_api_key', workspaceId: 'workspace-1', keyId: 'key-1' },
  ])(
    'preserves the $kind authority without substituting the uploader or billing owner',
    async (principal) => {
      await expect(
        readStoredWorkspaceFileRecordByKey.execute({ principal, input })
      ).resolves.toEqual({
        file,
      })
      if (principal.kind === 'personal_api_key') {
        expect(mocks.permission).toHaveBeenCalledWith('reader', 'workspace-1', null, undefined, {
          forUpdate: undefined,
        })
      } else {
        expect(mocks.permission).not.toHaveBeenCalled()
      }
    }
  )

  it('admits a deployment executor through workspace authority without consulting a human', async () => {
    await expect(
      readStoredWorkspaceFileRecordByKey.execute({ principal: executor(), input })
    ).resolves.toEqual({ file })
    expect(mocks.permission).not.toHaveBeenCalled()
  })

  it.each([{ fileId: 'file-1' }, { chatId: 'chat-1' }, { fileId: 'file-1', chatId: 'chat-1' }])(
    'retains a matching narrower delegation: %j',
    async (resourceScope) => {
      await expect(
        readStoredWorkspaceFileRecordByKey.execute({
          principal: executor({ resourceScope }),
          input,
        })
      ).resolves.toEqual({ file })
    }
  )

  it('keeps workspace files available to a chat-scoped delegate', async () => {
    mocks.metadata.mockResolvedValue({ ...file, context: 'workspace', chatId: null })
    await expect(
      readStoredWorkspaceFileRecordByKey.execute({
        principal: executor({ resourceScope: { chatId: 'chat-1' } }),
        input,
      })
    ).resolves.toMatchObject({ file: { context: 'workspace' } })
  })

  it.each<Partial<DelegatedPrincipal>>([
    { resourceScope: { fileId: 'other-file' } },
    { resourceScope: { chatId: 'other-chat' } },
    { resourceScope: { fileId: 'file-1', chatId: 'other-chat' } },
    { workspaceId: 'other-workspace' },
    { audience: 'other-audience' },
    { expiresAt: new Date(0) },
    { delegationContext: undefined },
  ])('rejects invalid delegation before reading content metadata: %j', async (overrides) => {
    await expect(
      readStoredWorkspaceFileRecordByKey.execute({ principal: executor(overrides), input })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.metadata).toHaveBeenCalledTimes(1)
    expect(mocks.permission).not.toHaveBeenCalled()
  })

  it('does not broaden a chat-scoped delegation when an attachment has no chat binding', async () => {
    mocks.metadata.mockResolvedValue({ ...file, chatId: null })
    await expect(
      readStoredWorkspaceFileRecordByKey.execute({
        principal: executor({ resourceScope: { chatId: 'chat-1' } }),
        input,
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('rechecks the real human behind an executor and denies revoked membership', async () => {
    mocks.permission.mockResolvedValue(null)
    const principal = executor({
      subjectUserId: 'reader',
      delegationContext: {
        ...executor().delegationContext!,
        principal: session,
      },
    })
    await expect(
      readStoredWorkspaceFileRecordByKey.execute({ principal, input })
    ).rejects.toMatchObject({
      code: 'forbidden',
    })
    expect(mocks.permission).toHaveBeenCalledWith('reader', 'workspace-1', null, undefined, {
      forUpdate: undefined,
    })
    expect(mocks.metadata).toHaveBeenCalledTimes(1)
  })

  it('rejects raw system identity before loading metadata', async () => {
    await expect(
      readStoredWorkspaceFileRecordByKey.execute({
        principal: {
          kind: 'system',
          serviceId: 'chat',
          workspaceId: 'workspace-1',
          workflowId: 'workflow-1',
        },
        input,
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.metadata).not.toHaveBeenCalled()
  })

  it('keeps absent initial metadata distinguishable for legacy access', async () => {
    mocks.metadata.mockResolvedValue(null)
    await expect(
      readStoredWorkspaceFileRecordByKey.execute({ principal: session, input })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.workspace).not.toHaveBeenCalled()
    expect(mocks.permission).not.toHaveBeenCalled()
  })

  it.each([
    { ...file, deletedAt: new Date() },
    { ...file, workspaceId: 'other-workspace' },
    { ...file, workspaceId: null },
    { ...file, organizationId: 'organization-1' },
    { ...file, context: 'execution' },
    { ...file, context: 'profile-pictures' },
    { ...file, key: 'workspace/workspace-1/different.png' },
  ])('refuses legacy fallback for invalid canonical metadata: %j', async (record) => {
    mocks.metadata.mockResolvedValue(record)
    await expect(
      readStoredWorkspaceFileRecordByKey.execute({ principal: session, input })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.workspace).not.toHaveBeenCalled()
    expect(mocks.permission).not.toHaveBeenCalled()
  })

  it.each([null, { ...workspace, workspaceId: 'other-workspace' }])(
    'rejects an inactive or changed workspace: %j',
    async (record) => {
      mocks.workspace.mockResolvedValue(record)
      await expect(
        readStoredWorkspaceFileRecordByKey.execute({ principal: session, input })
      ).rejects.toMatchObject({ code: 'forbidden' })
      expect(mocks.permission).not.toHaveBeenCalled()
    }
  )

  it.each([
    null,
    { ...file, id: 'replacement-file' },
    { ...file, key: 'workspace/workspace-1/new.png' },
    { ...file, deletedAt: new Date() },
    { ...file, workspaceId: 'other-workspace' },
    { ...file, context: 'workspace' },
    { ...file, chatId: 'other-chat' },
  ])('rejects an identity changed during authorization: %j', async (record) => {
    mocks.metadata.mockResolvedValueOnce(file).mockResolvedValueOnce(record)
    await expect(
      readStoredWorkspaceFileRecordByKey.execute({ principal: session, input })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.permission).toHaveBeenCalledOnce()
  })

  it.each([
    '',
    'legacy-unprefixed.png',
    'assistant/org-1/file.png',
    'execution/workspace-1/file.png',
  ])('rejects a storage key outside the shared workspace bucket: %s', async (key) => {
    await expect(
      readStoredWorkspaceFileRecordByKey.execute({ principal: session, input: { ...input, key } })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.metadata).not.toHaveBeenCalled()
  })
})
