/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { authorizeChat, listIntegrations } = vi.hoisted(() => ({
  authorizeChat: vi.fn(),
  listIntegrations: vi.fn(),
}))

vi.mock('@/lib/copilot/chat/organization-chats', () => ({
  authorizeOrganizationChatDelegation: { execute: authorizeChat },
}))
vi.mock('@/lib/knowledge/application/personal-search-integrations', () => ({
  listPersonalSearchIntegrations: { execute: listIntegrations },
}))

import { loadCopilotSearchIntegrations } from '@/lib/copilot/application/load-search-integrations'
import type { listPersonalSearchIntegrations } from '@/lib/knowledge/application/personal-search-integrations'

type InventoryPage = Awaited<ReturnType<typeof listPersonalSearchIntegrations.execute>>

const context = {
  userId: 'person-1',
  organizationId: 'org-1',
  chatId: 'private-chat-1',
  messageId: 'message-1',
}
const emptyPage: InventoryPage = {
  connections: [],
  available: [],
  completedCredentialId: null,
  nextCursor: null,
}

describe('loadCopilotSearchIntegrations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authorizeChat.mockResolvedValue(undefined)
    listIntegrations.mockResolvedValue(emptyPage)
  })

  it('authorizes the private chat and reads only for the authenticated person and organization', async () => {
    expect(await loadCopilotSearchIntegrations(context)).toBe('{"connections":[],"available":[]}')
    const principal = authorizeChat.mock.calls[0][0].principal
    expect(principal).toMatchObject({
      kind: 'organization_delegated',
      serviceId: 'copilot',
      subjectUserId: 'person-1',
      organizationId: 'org-1',
      delegationId: 'message-1',
      audience: 'sim:knowledge',
      resourceScope: { chatId: 'private-chat-1' },
    })
    expect(listIntegrations).toHaveBeenCalledExactlyOnceWith({
      principal,
      input: { organizationId: 'org-1' },
    })
    expect(authorizeChat.mock.invocationCallOrder[0]).toBeLessThan(
      listIntegrations.mock.invocationCallOrder[0]
    )
  })

  it('loads every page and preserves account status and exact connection controls', async () => {
    const available: InventoryPage['available'][number] = {
      name: 'Gmail',
      description: 'Personal mail',
      target: { type: 'link', provider: 'google-email', connectorType: 'gmail' },
    }
    const connection: InventoryPage['connections'][number] = {
      name: 'Gmail',
      providerId: 'google-email',
      connectorType: 'gmail',
      connectorId: 'source-1',
      knowledgeBaseId: 'kb-1',
      description: 'Personal mail',
      accounts: [
        {
          credentialId: 'account-1',
          displayName: 'me@example.com',
          status: 'reconnect_needed',
          action: { ...available.target, connectorId: 'source-1', credentialId: 'account-1' },
        },
      ],
      connectionStatus: 'reconnect_needed',
      indexingStatus: 'indexed',
      searchableDocuments: 7,
      action: null,
    }
    listIntegrations
      .mockResolvedValueOnce({ ...emptyPage, available: [available], nextCursor: 'page-2' })
      .mockResolvedValueOnce({ ...emptyPage, connections: [connection], available: [available] })

    expect(JSON.parse(await loadCopilotSearchIntegrations(context))).toEqual({
      connections: [connection],
      available: [available],
    })
    expect(listIntegrations.mock.calls[1][0]).toEqual({
      principal: authorizeChat.mock.calls[0][0].principal,
      input: { organizationId: 'org-1', cursor: 'page-2' },
    })
  })

  it('does not read inventory when private-chat authorization fails', async () => {
    authorizeChat.mockRejectedValueOnce(new Error('Chat belongs to another person'))
    await expect(loadCopilotSearchIntegrations(context)).rejects.toThrow(
      'Chat belongs to another person'
    )
    expect(listIntegrations).not.toHaveBeenCalled()
  })

  it('fails the turn if a later page cannot be read', async () => {
    listIntegrations
      .mockResolvedValueOnce({ ...emptyPage, nextCursor: 'page-2' })
      .mockRejectedValueOnce(new Error('Inventory unavailable'))
    await expect(loadCopilotSearchIntegrations(context)).rejects.toThrow('Inventory unavailable')
  })

  it('rejects a repeated cursor instead of looping or returning partial inventory', async () => {
    listIntegrations.mockResolvedValue({ ...emptyPage, nextCursor: 'page-2' })
    await expect(loadCopilotSearchIntegrations(context)).rejects.toThrow(
      'pagination did not advance'
    )
    expect(listIntegrations).toHaveBeenCalledTimes(2)
  })

  it('bounds page loading when the inventory never ends', async () => {
    listIntegrations.mockImplementation(async () => ({
      ...emptyPage,
      nextCursor: `page-${listIntegrations.mock.calls.length + 1}`,
    }))
    await expect(loadCopilotSearchIntegrations(context)).rejects.toThrow('pagination limit')
    expect(listIntegrations).toHaveBeenCalledTimes(100)
  })

  it('rejects oversized prompt content instead of silently truncating it', async () => {
    listIntegrations.mockResolvedValueOnce({
      ...emptyPage,
      available: [
        {
          name: 'Gmail',
          description: 'x'.repeat(256 * 1024),
          target: { type: 'link', provider: 'google-email', connectorType: 'gmail' },
        },
      ],
    })
    await expect(loadCopilotSearchIntegrations(context)).rejects.toThrow('prompt size limit')
  })

  it('stops loading when the turn is cancelled between pages', async () => {
    const controller = new AbortController()
    listIntegrations.mockImplementationOnce(async () => {
      controller.abort(new Error('Turn cancelled'))
      return { ...emptyPage, nextCursor: 'page-2' }
    })
    await expect(
      loadCopilotSearchIntegrations({ ...context, signal: controller.signal })
    ).rejects.toThrow('Turn cancelled')
    expect(listIntegrations).toHaveBeenCalledTimes(1)
  })
})
