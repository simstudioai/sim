import type { DelegatedPrincipal, OrganizationDelegatedPrincipal } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { resolve, sectionAccess } = vi.hoisted(() => ({ resolve: vi.fn(), sectionAccess: vi.fn() }))
vi.mock('@/lib/settings/application/organization-section-access', () => ({
  authorizeOrganizationSettingsSection: sectionAccess,
}))
vi.mock('@/lib/mothership/application/settings-context', () => ({
  resolveSettingsContext: resolve,
}))

import { deleteOrganizationByokKey } from '@/lib/api-key/application/organization-byok-keys'
import {
  listPersonalApiKeys,
  revokePersonalApiKey,
} from '@/lib/api-key/application/personal-api-keys'
import {
  listWorkspaceApiKeys,
  renameWorkspaceApiKey,
  revokeWorkspaceApiKey,
} from '@/lib/api-key/application/workspace-api-keys'
import { deleteWorkspaceByokKey } from '@/lib/api-key/application/workspace-byok-keys'
import { updateOrganizationMemberUsageLimit } from '@/lib/billing/application/member-usage-limits/use-cases'
import { readUsageLimit, updateUsageLimit } from '@/lib/billing/application/usage-limits'
import { listWorkspaceInvitations } from '@/lib/invitations/application/list-workspace-invitations'
import {
  cancelWorkspaceInvitation,
  resendWorkspaceInvitation,
} from '@/lib/invitations/application/manage-invitation'
import { sendWorkspaceInvitationBatch } from '@/lib/invitations/application/send-invitation-batch'
import {
  listWorkspaceChats,
  restoreMothershipChat,
} from '@/lib/mothership/chat/application/use-cases'
import { listOrganizationChats } from '@/lib/mothership/chat/organization-chats'
import { settingsServerTool } from '@/lib/mothership/tools/server/settings'
import { readInboxSettings, updateInboxSettings } from '@/lib/workspaces/application/inbox-settings'

const base = {
  serviceId: 'copilot',
  subjectUserId: 'actor',
  delegationId: 'call',
  audience: 'sim:settings',
  issuedAt: new Date(),
  expiresAt: new Date(Date.now() + 60000),
  resourceScope: { chatId: 'current-chat' },
} as const
const organizationPrincipal: OrganizationDelegatedPrincipal = {
  ...base,
  kind: 'organization_delegated',
  organizationId: 'trusted-org',
}
const workspacePrincipal: DelegatedPrincipal = {
  ...base,
  kind: 'delegated',
  workspaceId: 'trusted-workspace',
}
function target(scope: 'account' | 'organization' | 'workspace') {
  resolve.mockResolvedValue({
    scope,
    principal: scope === 'workspace' ? workspacePrincipal : organizationPrincipal,
    organizationId: 'trusted-org',
    ...(scope === 'workspace' ? { workspaceId: 'trusted-workspace' } : {}),
  })
}
function execute(
  scope: 'account' | 'organization' | 'workspace',
  section: string,
  operation: string,
  input: Record<string, unknown>
) {
  return settingsServerTool.execute({ scope, section, action: 'execute', operation, input })
}
beforeEach(() => {
  vi.restoreAllMocks()
  sectionAccess.mockReset().mockResolvedValue(true)
  resolve.mockReset()
  target('workspace')
})
describe('settings management adapter boundaries', () => {
  it('checks current organization section access before forwarding a billing mutation', async () => {
    target('organization')
    sectionAccess.mockResolvedValue(false)
    const update = vi.spyOn(updateUsageLimit, 'execute').mockResolvedValue({} as never)
    await expect(
      execute('organization', 'billing', 'set_spending_limit', { limit: 12.5 })
    ).rejects.toThrow('unavailable for your current organization access')
    expect(sectionAccess).toHaveBeenCalledWith({
      organizationId: 'trusted-org',
      userId: 'actor',
      section: 'billing',
    })
    expect(update).not.toHaveBeenCalled()
  })

  it.each(['account', 'organization'] as const)(
    'binds %s dollar caps to trusted context and passes dollars unchanged',
    async (scope) => {
      target(scope)
      const update = vi.spyOn(updateUsageLimit, 'execute').mockResolvedValue({} as never)
      await execute(scope, 'billing', 'set_spending_limit', { limit: 12.5 })
      expect(update).toHaveBeenCalledWith({
        principal: organizationPrincipal,
        input: {
          limit: 12.5,
          context: scope === 'account' ? 'user' : 'organization',
          ...(scope === 'organization' ? { organizationId: 'trusted-org' } : {}),
        },
      })
      await expect(
        execute(scope, 'billing', 'set_spending_limit', { limit: 12.5, organizationId: 'foreign' })
      ).rejects.toThrow('Unrecognized')
      expect(update).toHaveBeenCalledTimes(1)
    }
  )
  it('binds account reads without an input-selected user', async () => {
    target('account')
    const read = vi.spyOn(readUsageLimit, 'execute').mockResolvedValue({} as never)
    await execute('account', 'billing', 'get_spending_limit', {})
    expect(read).toHaveBeenCalledWith({
      principal: organizationPrincipal,
      input: { context: 'user', memberLimit: 50, memberOffset: 0 },
    })
    await expect(
      execute('account', 'billing', 'get_spending_limit', { userId: 'payer' })
    ).rejects.toThrow('Unrecognized')
  })
  it.each([400, null])(
    'keeps member credit units and nullable clear value %s',
    async (creditLimit) => {
      target('organization')
      const update = vi
        .spyOn(updateOrganizationMemberUsageLimit, 'execute')
        .mockResolvedValue({ creditLimit })
      await execute('organization', 'billing', 'set_member_limit', {
        userId: 'external-member',
        creditLimit,
      })
      expect(update).toHaveBeenCalledWith({
        principal: organizationPrincipal,
        input: { organizationId: 'trusted-org', userId: 'external-member', creditLimit },
      })
      await expect(
        execute('organization', 'billing', 'set_member_limit', {
          userId: 'external-member',
          creditLimit: 1.5,
        })
      ).rejects.toThrow()
      await expect(
        execute('organization', 'billing', 'set_member_limit', {
          userId: 'external-member',
          creditLimit,
          organizationId: 'foreign',
        })
      ).rejects.toThrow('Unrecognized')
      expect(update).toHaveBeenCalledTimes(1)
    }
  )
  it('keeps key reads metadata-only and forwards trusted workspace', async () => {
    const safe = {
      keys: [
        {
          id: 'key-id',
          name: 'Automation',
          displayKey: 'sim_****last',
          createdAt: new Date(),
          lastUsed: null,
          expiresAt: null,
        },
      ],
    }
    const list = vi.spyOn(listWorkspaceApiKeys, 'execute').mockResolvedValue(safe as never)
    const result = await settingsServerTool.execute({
      scope: 'workspace',
      section: 'api-keys',
      action: 'get',
    })
    expect(list).toHaveBeenCalledWith({
      principal: workspacePrincipal,
      input: { workspaceId: 'trusted-workspace' },
    })
    expect(result).toMatchObject({ value: safe })
    expect(JSON.stringify(result)).not.toMatch(/encryptedKey|encryptedApiKey|"key":/)
    target('account')
    const personal = vi.spyOn(listPersonalApiKeys, 'execute').mockResolvedValue(safe as never)
    await settingsServerTool.execute({ scope: 'account', section: 'api-keys', action: 'get' })
    expect(personal).toHaveBeenCalledWith({ principal: organizationPrincipal, input: {} })
  })
  it('revoke drops workspace metadata and rejects key material or foreign scope input', async () => {
    const revoke = vi.spyOn(revokeWorkspaceApiKey, 'execute').mockResolvedValue({
      success: true,
      key: { id: 'key', name: 'PRIVATE_METADATA', lastUsed: null },
    })
    const result = await execute('workspace', 'api-keys', 'revoke', { keyId: 'key' })
    expect(revoke).toHaveBeenCalledWith({
      principal: workspacePrincipal,
      input: { keyId: 'key', workspaceId: 'trusted-workspace' },
    })
    expect(result).toMatchObject({ result: { success: true } })
    expect(JSON.stringify(result)).not.toContain('PRIVATE_METADATA')
    await expect(
      execute('workspace', 'api-keys', 'revoke', { keyId: 'key', workspaceId: 'foreign' })
    ).rejects.toThrow('Unrecognized')
    await expect(
      execute('workspace', 'api-keys', 'rename', { keyId: 'key', name: 'New', key: 'secret' })
    ).rejects.toThrow('Unrecognized')
  })
  it('binds personal revoke to acting account and workspace rename to trusted workspace', async () => {
    target('account')
    const personal = vi.spyOn(revokePersonalApiKey, 'execute').mockResolvedValue({ success: true })
    await execute('account', 'api-keys', 'revoke', { keyId: 'key' })
    expect(personal).toHaveBeenCalledWith({
      principal: organizationPrincipal,
      input: { keyId: 'key' },
    })
    target('workspace')
    const rename = vi
      .spyOn(renameWorkspaceApiKey, 'execute')
      .mockResolvedValue({ key: { id: 'key', name: 'New' } } as never)
    await execute('workspace', 'api-keys', 'rename', { keyId: 'key', name: 'New' })
    expect(rename).toHaveBeenCalledWith({
      principal: workspacePrincipal,
      input: { keyId: 'key', name: 'New', workspaceId: 'trusted-workspace' },
    })
  })
  it.each(['organization', 'workspace'] as const)(
    'binds %s BYOK revocation without accepting credential input',
    async (scope) => {
      target(scope)
      const revoke = vi
        .spyOn(
          scope === 'organization' ? deleteOrganizationByokKey : deleteWorkspaceByokKey,
          'execute'
        )
        .mockResolvedValue({ success: true, deletedKeyIds: ['key'] })
      await execute(scope, 'byok', 'revoke', { providerId: 'openai', keyId: 'key' })
      expect(revoke).toHaveBeenCalledWith({
        principal: scope === 'organization' ? organizationPrincipal : workspacePrincipal,
        input: {
          providerId: 'openai',
          keyId: 'key',
          ...(scope === 'organization'
            ? { organizationId: 'trusted-org' }
            : { workspaceId: 'trusted-workspace' }),
        },
      })
      await expect(
        execute(scope, 'byok', 'revoke', { providerId: 'openai', apiKey: 'SECRET' })
      ).rejects.toThrow('Unrecognized')
    }
  )
  it('binds workspace invitations and rejects model-selected multi-workspace targets', async () => {
    const send = vi.spyOn(sendWorkspaceInvitationBatch, 'execute').mockResolvedValue({} as never)
    await execute('workspace', 'teammates', 'invite', {
      emails: ['member@example.com'],
      permission: 'read',
      membership: 'member',
    })
    expect(send).toHaveBeenCalledWith({
      principal: workspacePrincipal,
      input: {
        emails: ['member@example.com'],
        permission: 'read',
        membership: 'member',
        workspaceIds: ['trusted-workspace'],
      },
    })
    await expect(
      execute('workspace', 'teammates', 'invite', {
        emails: ['member@example.com'],
        workspaceIds: ['foreign'],
      })
    ).rejects.toThrow('Unrecognized')
    const list = vi.spyOn(listWorkspaceInvitations, 'execute').mockResolvedValue({} as never)
    await execute('workspace', 'teammates', 'list_invitations', {})
    expect(list).toHaveBeenCalledWith({
      principal: workspacePrincipal,
      input: { workspaceId: 'trusted-workspace' },
    })
    for (const [name, operation] of [
      ['resend_invitation', resendWorkspaceInvitation],
      ['cancel_invitation', cancelWorkspaceInvitation],
    ] as const) {
      const spy = vi.spyOn(operation, 'execute').mockResolvedValue({} as never)
      await execute('workspace', 'teammates', name, { invitationId: 'invite' })
      expect(spy).toHaveBeenCalledWith({
        principal: workspacePrincipal,
        input: { invitationId: 'invite', workspaceId: 'trusted-workspace' },
      })
    }
  })
  it('binds inbox reads and updates and rejects undeclared secret fields', async () => {
    const read = vi.spyOn(readInboxSettings, 'execute').mockResolvedValue({} as never)
    const update = vi.spyOn(updateInboxSettings, 'execute').mockResolvedValue({} as never)
    await settingsServerTool.execute({ scope: 'workspace', section: 'inbox', action: 'get' })
    expect(read).toHaveBeenCalledWith({
      principal: workspacePrincipal,
      input: { workspaceId: 'trusted-workspace' },
    })
    await settingsServerTool.execute({
      scope: 'workspace',
      section: 'inbox',
      action: 'update',
      changes: { enabled: true },
    })
    expect(update).toHaveBeenCalledWith({
      principal: workspacePrincipal,
      input: { workspaceId: 'trusted-workspace', patch: { enabled: true } },
    })
    await expect(
      settingsServerTool.execute({
        scope: 'workspace',
        section: 'inbox',
        action: 'update',
        changes: { token: 'SECRET', workspaceId: 'foreign' },
      })
    ).rejects.toThrow('Unrecognized')
    expect(update).toHaveBeenCalledTimes(1)
  })
  it.each(['organization', 'workspace'] as const)(
    'projects archived %s chat metadata and binds restoration assertions',
    async (scope) => {
      target(scope)
      const list = vi
        .spyOn(scope === 'organization' ? listOrganizationChats : listWorkspaceChats, 'execute')
        .mockResolvedValue([
          {
            id: 'chat',
            title: 'Archived',
            deletedAt: new Date(),
            updatedAt: new Date(),
            messages: ['PRIVATE_CONTENT'],
            streamId: 'PRIVATE_STREAM',
            model: 'PRIVATE_MODEL',
          },
        ] as never)
      const result = await execute(scope, 'recently-deleted', 'list_chats', { limit: 5 })
      expect(list).toHaveBeenCalledWith({
        principal: scope === 'organization' ? organizationPrincipal : workspacePrincipal,
        input: {
          scope: 'archived',
          limit: 5,
          ...(scope === 'organization'
            ? { organizationId: 'trusted-org' }
            : { workspaceId: 'trusted-workspace' }),
        },
      })
      expect(JSON.stringify(result)).not.toContain('PRIVATE_')
      const restore = vi.spyOn(restoreMothershipChat, 'execute').mockResolvedValue({
        chatId: 'chat',
        userId: 'actor',
        workspaceId: null,
        organizationId: 'trusted-org',
      })
      await execute(scope, 'recently-deleted', 'restore_chat', { chatId: 'chat' })
      expect(restore).toHaveBeenCalledWith({
        principal: scope === 'organization' ? organizationPrincipal : workspacePrincipal,
        input: {
          chatId: 'chat',
          ...(scope === 'organization'
            ? { assertedOrganizationId: 'trusted-org' }
            : { assertedWorkspaceId: 'trusted-workspace' }),
        },
      })
      await expect(
        execute(scope, 'recently-deleted', 'restore_chat', {
          chatId: 'chat',
          assertedWorkspaceId: 'foreign',
        })
      ).rejects.toThrow('Unrecognized')
      await expect(
        execute(scope, 'recently-deleted', 'list_chats', { limit: 201 })
      ).rejects.toThrow()
    }
  )
})
