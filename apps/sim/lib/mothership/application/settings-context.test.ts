import {
  mothershipOrganizationChatsMock,
  mothershipOrganizationChatsMockFns,
} from '@sim/testing/mocks/mothership-organization-chats.mock'
import {
  mothershipWorkspaceTargetMock,
  mothershipWorkspaceTargetMockFns,
} from '@sim/testing/mocks/mothership-workspace-target.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { context } = vi.hoisted(() => ({ context: vi.fn() }))
vi.mock('@/lib/mothership/application/workspace-target', () => mothershipWorkspaceTargetMock)
vi.mock('@/lib/settings/application/context', () => ({
  readSettingsWorkspaceContext: { execute: context },
}))
vi.mock('@/lib/mothership/chat/organization-chats', () => mothershipOrganizationChatsMock)

import { resolveSettingsContext } from '@/lib/mothership/application/settings-context'

const boundary = {
  workspace: mothershipWorkspaceTargetMockFns.mockResolveInvocationWorkspace,
  context,
  organization: mothershipOrganizationChatsMockFns.mockAuthorizeOrganizationChatDelegation,
}

const workspace = {
  userId: 'actor',
  workspaceId: 'workspace-a',
  chatId: 'chat-a',
  toolCallId: 'call-a',
  copilotToolExecution: true,
  requestMode: 'agent',
}
const organization = { ...workspace, workspaceId: undefined, organizationId: 'organization-a' }

describe('settings conversation scope', () => {
  beforeEach(() => {
    boundary.workspace.mockResolvedValue({ workspaceId: 'workspace-a' })
    boundary.context.mockResolvedValue({
      workspaceId: 'workspace-a',
      organizationId: 'organization-a',
    })
    boundary.organization.mockResolvedValue({ organizationId: 'organization-a' })
  })

  it('requires a trusted agent context before organization or account discovery', async () => {
    await expect(
      resolveSettingsContext('account', { ...organization, copilotToolExecution: false })
    ).rejects.toThrow()
    await expect(
      resolveSettingsContext('organization', { ...organization, requestMode: 'assistant' })
    ).rejects.toThrow('agent mode')
    expect(boundary.organization).not.toHaveBeenCalled()
  })

  it('authorizes the actual org chat, with no workspace default', async () => {
    const result = await resolveSettingsContext('account', organization)
    expect(result.principal).toMatchObject({
      kind: 'organization_delegated',
      subjectUserId: 'actor',
      organizationId: 'organization-a',
      audience: 'sim:settings',
    })
    expect(boundary.organization).toHaveBeenCalledWith({ principal: result.principal })
    expect(boundary.workspace).not.toHaveBeenCalled()
    await expect(resolveSettingsContext('workspace', organization)).rejects.toThrow(
      'explicit workspace'
    )
    await expect(resolveSettingsContext('account', organization, 'workspace-a')).rejects.toThrow(
      'do not take'
    )
  })

  it('keeps workspace targets bound to the current invocation', async () => {
    await expect(resolveSettingsContext('workspace', workspace, 'workspace-b')).rejects.toThrow(
      'not found'
    )
    expect(boundary.workspace).not.toHaveBeenCalled()
    const result = await resolveSettingsContext('workspace', {
      ...workspace,
      chatOrganizationId: 'organization-a',
    })
    expect(boundary.workspace).toHaveBeenCalledWith(
      expect.objectContaining({ chatOrganizationId: 'organization-a', workspaceId: 'workspace-a' }),
      'workspace-a'
    )
    expect(result.principal).toMatchObject({
      kind: 'delegated',
      subjectUserId: 'actor',
      workspaceId: 'workspace-a',
    })
  })

  it('never promotes a workspace conversation into parent organization settings', async () => {
    await expect(resolveSettingsContext('organization', workspace)).rejects.toThrow(
      'organization conversation'
    )
    expect(boundary.context).not.toHaveBeenCalled()
    expect(boundary.organization).not.toHaveBeenCalled()
    boundary.workspace.mockRejectedValueOnce(new Error('Access revoked'))
    await expect(resolveSettingsContext('account', workspace)).rejects.toThrow('Access revoked')
  })
})
