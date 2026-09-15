/** @vitest-environment node */
import { beforeEach, expect, it, vi } from 'vitest'
import { createTrustedOrganizationCopilotPrincipal } from '@/lib/mothership/auth/application-delegation'
import { FUNCTION_EXECUTION_DELEGATION_AUDIENCE } from './authorization'

const mocks = vi.hoisted(() => ({ context: vi.fn(), authorize: vi.fn(), execute: vi.fn() }))
vi.mock('@/lib/mothership/chat/application/context', () => ({
  resolveOwnedChatContext: mocks.context,
}))
vi.mock('@/lib/core/application/organization-authorization', () => ({
  authorizeOrganizationOperation: mocks.authorize,
}))
vi.mock('@/lib/function-execution/execute-request', () => ({
  executeFunctionRequest: mocks.execute,
}))

import { executeChatFunction } from './execute-chat-function'

const principal = createTrustedOrganizationCopilotPrincipal(
  { userId: 'actor', organizationId: 'org', chatId: 'chat', delegationId: 'test' },
  { audience: FUNCTION_EXECUTION_DELEGATION_AUDIENCE, ttlMs: 60000 }
)
const input = {
  organizationId: 'org',
  chatId: 'chat',
  headers: new Headers(),
  body: {
    code: 'return 1',
    secretScope: 'selected' as const,
    sandboxSessionKey: 'mothership-chat:chat',
  },
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.context.mockResolvedValue({
    organizationId: 'org',
    chatId: 'chat',
    userId: 'actor',
    mode: 'agent',
  })
  mocks.execute.mockResolvedValue(Response.json({ success: true }))
})
it('runs through the existing Function executor after fresh owner authorization without a workspace', async () => {
  await executeChatFunction.execute({ principal, input })
  expect(mocks.authorize).toHaveBeenCalledWith(
    principal,
    expect.objectContaining({ capability: 'copilot.use', minimumRole: 'member' }),
    { organizationId: 'org' }
  )
  expect(mocks.execute).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ code: 'return 1', secretScope: 'selected' }),
    expect.objectContaining({ principal, attributedUserId: 'actor', sandboxProfile: 'mothership' })
  )
  expect(mocks.execute.mock.calls[0][1]).not.toHaveProperty('workspaceId')
  mocks.authorize.mockRejectedValueOnce(new Error('membership revoked'))
  await expect(executeChatFunction.execute({ principal, input })).rejects.toThrow(
    'membership revoked'
  )
  expect(mocks.execute).toHaveBeenCalledTimes(1)
})
it.each([
  { workspaceId: 'other' },
  { workflowId: 'workflow' },
  { sandboxId: 'saved' },
  { envVars: { TOKEN: 'secret' } },
  { secretScope: 'all' },
  { mountedSecrets: ['KEY'] },
  { fileKeys: ['private'] },
  { largeValueKeys: ['private'] },
  { sandboxSessionKey: 'mothership-chat:other' },
])('refuses unbound workspace authority %j', async (override) => {
  await expect(
    executeChatFunction.execute({
      principal,
      input: { ...input, body: { ...input.body, ...override } },
    })
  ).rejects.toThrow()
  expect(mocks.execute).not.toHaveBeenCalled()
})
it.each([{ organizationId: 'other' }, { mode: 'assistant' }, { workspaceId: 'workspace' }])(
  'refuses mismatched owned chat %j',
  async (override) => {
    mocks.context.mockResolvedValue({
      organizationId: 'org',
      chatId: 'chat',
      userId: 'actor',
      mode: 'agent',
      ...override,
    })
    await expect(executeChatFunction.execute({ principal, input })).rejects.toThrow()
    expect(mocks.execute).not.toHaveBeenCalled()
  }
)
it('refuses a different delegated chat even if context lookup returns another chat', async () => {
  await expect(
    executeChatFunction.execute({
      principal: { ...principal, resourceScope: { chatId: 'other' } },
      input,
    })
  ).rejects.toThrow()
  expect(mocks.execute).not.toHaveBeenCalled()
})
