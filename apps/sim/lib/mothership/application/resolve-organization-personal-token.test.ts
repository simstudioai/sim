import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ chat: vi.fn(), token: vi.fn() }))
vi.mock('@/lib/mothership/chat/organization-chats', () => ({
  authorizeOrganizationChatDelegation: { execute: mocks.chat },
}))
vi.mock('@/lib/credentials/application/resolve-organization-personal-token', () => ({
  resolveOrganizationPersonalToken: {
    operation: { id: 'credentials.organization.personal.use', delegationAudience: 'sim:knowledge' },
    execute: mocks.token,
  },
  prepareOrganizationPersonalConnection: {
    operation: {
      id: 'credentials.organization.personal.prepareConnection',
      delegationAudience: 'sim:knowledge',
    },
  },
}))

import { resolveCopilotOrganizationPersonalToken } from '@/lib/mothership/application/resolve-organization-personal-token'

const context = {
  userId: 'person',
  organizationId: 'org',
  chatId: 'chat',
  toolCallId: 'call',
  copilotToolExecution: true,
  requestMode: 'assistant',
}
const input = {
  credentialId: 'credential',
  expectedProviderId: 'slack',
  requiredScopes: ['read'],
  toolId: 'slack_read',
}

describe('organization personal credential adapter', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('binds the authenticated chat owner and organization into the application invocation', async () => {
    await resolveCopilotOrganizationPersonalToken(context, input)
    expect(mocks.chat).toHaveBeenCalledWith({
      principal: expect.objectContaining({
        kind: 'organization_delegated',
        subjectUserId: 'person',
        organizationId: 'org',
        resourceScope: { chatId: 'chat' },
      }),
    })
    expect(mocks.token).toHaveBeenCalledWith({
      principal: mocks.chat.mock.calls[0][0].principal,
      input: { ...input, organizationId: 'org' },
    })
  })

  it.each(['another owner', 'deleted chat'])(
    'rejects %s before token resolution',
    async (reason) => {
      mocks.chat.mockRejectedValue(new Error(reason))
      await expect(resolveCopilotOrganizationPersonalToken(context, input)).rejects.toThrow(reason)
      expect(mocks.token).not.toHaveBeenCalled()
    }
  )

  it.each([
    { workspaceId: 'workspace' },
    { workflowId: 'workflow' },
    { copilotToolExecution: false },
    { chatId: '' },
    { toolCallId: '' },
  ])('rejects forged or incomplete authority %j', async (change) => {
    await expect(
      resolveCopilotOrganizationPersonalToken({ ...context, ...change }, input)
    ).rejects.toThrow()
    expect(mocks.token).not.toHaveBeenCalled()
  })
})
