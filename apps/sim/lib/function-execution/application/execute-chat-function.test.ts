import { beforeEach, expect, it, vi } from 'vitest'
import { FUNCTION_EXECUTION_DELEGATION_AUDIENCE } from '@/lib/function-execution/application/authorization'
import { createTrustedOrganizationCopilotPrincipal } from '@/lib/mothership/auth/application-delegation'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

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

import { executeChatFunction } from '@/lib/function-execution/application/execute-chat-function'

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
  mocks.context.mockResolvedValue({
    organizationId: 'org',
    chatId: 'chat',
    userId: 'actor',
    mode: 'agent',
  })
  mocks.execute.mockResolvedValue(Response.json({ success: true }))
})
it.each(['agent', 'plan'])(
  'runs through the existing Function executor after fresh %s owner authorization without a workspace',
  async (mode) => {
    mocks.context.mockResolvedValue({
      organizationId: 'org',
      chatId: 'chat',
      userId: 'actor',
      mode,
    })
    await executeChatFunction.execute({ principal, input })
    expect(mocks.authorize).toHaveBeenCalledWith(
      principal,
      expect.objectContaining({ capability: 'copilot.use', minimumRole: 'member' }),
      { organizationId: 'org' }
    )
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ code: 'return 1', secretScope: 'selected' }),
      expect.objectContaining({
        principal,
        attributedUserId: 'actor',
        sandboxProfile: 'mothership',
      })
    )
    expect(mocks.execute.mock.calls[0][1]).not.toHaveProperty('workspaceId')
    mocks.authorize.mockRejectedValueOnce(new Error('membership revoked'))
    await expect(executeChatFunction.execute({ principal, input })).rejects.toThrow(
      'membership revoked'
    )
    expect(mocks.execute).toHaveBeenCalledTimes(1)
  }
)
it.each(['agent', 'plan'])('accepts only authorized organization mounts in %s', async (mode) => {
  mocks.context.mockResolvedValue({ organizationId: 'org', chatId: 'chat', userId: 'actor', mode })
  const registry = new ResolvedSecretTraceRegistry([
    { name: 'TOKEN', plaintext: 'test-token', encryptedValue: 'test-cipher' },
  ])
  await executeChatFunction.execute({
    principal,
    input: {
      ...input,
      resolvedSecretTraceRegistry: registry,
      body: { ...input.body, mountedSecrets: ['TOKEN'], envVars: { TOKEN: 'test-token' } },
    },
  })
  expect(mocks.execute).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ mountedSecrets: ['TOKEN'], envVars: { TOKEN: 'test-token' } }),
    expect.objectContaining({ resolvedSecretTraceRegistry: registry })
  )
  expect(registry.getActiveMatches()).toEqual(
    expect.arrayContaining([expect.objectContaining({ plaintext: 'test-token' })])
  )
})
it.each([
  { envVars: { TOKEN: 'forged' }, mountedSecrets: ['TOKEN'] },
  { envVars: { OTHER: 'test-token' }, mountedSecrets: ['OTHER'] },
  { envVars: { TOKEN: 'test-token', EXTRA: 'unlisted' }, mountedSecrets: ['TOKEN'] },
  { envVars: { TOKEN: 'test-token', EXTRA: 'unlisted' }, mountedSecrets: ['TOKEN', 'TOKEN'] },
])('refuses values or names outside the trusted mount catalog %j', async (body) => {
  await expect(
    executeChatFunction.execute({
      principal,
      input: {
        ...input,
        body: { ...input.body, ...body },
        resolvedSecretTraceRegistry: new ResolvedSecretTraceRegistry([
          { name: 'TOKEN', plaintext: 'test-token', encryptedValue: 'test-cipher' },
        ]),
      },
    })
  ).rejects.toThrow('authorized mount')
  expect(mocks.execute).not.toHaveBeenCalled()
})
it('refuses a mount with no trusted in-process provenance', async () => {
  await expect(
    executeChatFunction.execute({
      principal,
      input: {
        ...input,
        body: { ...input.body, mountedSecrets: ['TOKEN'], envVars: { TOKEN: 'test-token' } },
      },
    })
  ).rejects.toThrow('authorized mount')
  expect(mocks.execute).not.toHaveBeenCalled()
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
