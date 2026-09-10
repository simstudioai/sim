/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ read: vi.fn(), authorizeChat: vi.fn() }))
vi.mock('@/lib/copilot/chat/organization-chats', () => ({
  authorizeOrganizationChatDelegation: { execute: m.authorizeChat },
}))
vi.mock('@/lib/knowledge/application/personal-search-integrations', () => ({
  listPersonalSearchIntegrations: {
    get operation() {
      return knowledgeOperations.listPersonalSearchIntegrations
    },
    execute: m.read,
  },
}))

import { listIntegrationsServerTool } from '@/lib/copilot/tools/server/knowledge/list-integrations'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'

const context = {
  userId: 'person',
  organizationId: 'org',
  chatId: 'private-chat',
  toolCallId: 'call',
  requestMode: 'assistant',
  copilotToolExecution: true,
}
beforeEach(() => {
  vi.clearAllMocks()
  m.authorizeChat.mockResolvedValue(undefined)
  m.read.mockResolvedValue({ connections: [], available: [], nextCursor: null })
})
describe('list_integrations', () => {
  it('binds the read to the authorized current person and private organization chat', async () => {
    expect(
      await listIntegrationsServerTool.execute({ connectorType: 'gmail', cursor: 'page' }, context)
    ).toMatchObject({ success: true })
    expect(m.read).toHaveBeenCalledWith({
      principal: expect.objectContaining({
        subjectUserId: 'person',
        organizationId: 'org',
        resourceScope: { chatId: 'private-chat' },
      }),
      input: { organizationId: 'org', connectorType: 'gmail', cursor: 'page' },
    })
    expect(m.authorizeChat).toHaveBeenCalledOnce()
  })
  it.each([
    { organizationId: 'forged' },
    { userId: 'another' },
    { connectorType: 'x'.repeat(101) },
    { cursor: 'x'.repeat(1025) },
  ])('rejects forged scope and unbounded arguments', async (args) => {
    expect(await listIntegrationsServerTool.execute(args, context)).toMatchObject({
      success: false,
    })
    expect(m.read).not.toHaveBeenCalled()
  })
  it.each([
    { ...context, workspaceId: 'workspace' },
    { ...context, requestMode: 'agent' },
    { ...context, chatId: undefined },
    { ...context, copilotToolExecution: false },
  ])('rejects untrusted or non-organization contexts', async (invalid) => {
    expect(await listIntegrationsServerTool.execute({}, invalid)).toMatchObject({ success: false })
    expect(m.read).not.toHaveBeenCalled()
  })
  it('checks revoked chat access before returning any account data', async () => {
    m.authorizeChat.mockRejectedValue(new Error('revoked'))
    expect(await listIntegrationsServerTool.execute({}, context)).toMatchObject({ success: false })
    expect(m.read).not.toHaveBeenCalled()
  })
})
