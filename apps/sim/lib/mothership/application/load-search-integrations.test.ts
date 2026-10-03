import { resetEnvFlagsMock } from '@sim/testing'
import {
  mothershipOrganizationChatsMock,
  mothershipOrganizationChatsMockFns,
} from '@sim/testing/mocks/mothership-organization-chats.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { listIntegrations, liveAccounts } = vi.hoisted(() => ({
  liveAccounts: vi.fn(),
  listIntegrations: vi.fn(),
}))

vi.mock('@/lib/sim-search/live/application', () => ({
  listLiveSearchAccounts: { execute: liveAccounts },
}))

vi.mock('@/lib/mothership/chat/organization-chats', () => mothershipOrganizationChatsMock)
vi.mock('@/lib/knowledge/application/personal-search-integrations', () => ({
  listPersonalSearchIntegrations: { execute: listIntegrations },
}))

import type { listPersonalSearchIntegrations } from '@/lib/knowledge/application/personal-search-integrations'
import { loadCopilotSearchIntegrations } from '@/lib/mothership/application/load-search-integrations'

const authorizeChat = mothershipOrganizationChatsMockFns.mockAuthorizeOrganizationChatDelegation

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
    resetEnvFlagsMock()

    authorizeChat.mockResolvedValue(undefined)
    listIntegrations.mockResolvedValue(emptyPage)
    liveAccounts.mockResolvedValue({ backend: 'live', accounts: [] })
  })

  it('authorizes the private chat and reads only for the authenticated person and organization', async () => {
    expect(JSON.parse(await loadCopilotSearchIntegrations(context))).toMatchObject({
      connections: [],
      available: [],
    })
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

  it('includes exact live connection targets alongside current provider search accounts', async () => {
    const target = {
      type: 'link',
      provider: 'slack',
      connectorType: 'slack',
      connectionMode: 'live',
      optionId: 'slack-option',
    }
    listIntegrations.mockResolvedValue({
      ...emptyPage,
      available: [{ name: 'Slack', description: '', target }],
    })
    liveAccounts.mockResolvedValue({
      backend: 'live',
      accounts: [],
      guidance: 'Search current sources',
    })
    const result = JSON.parse(await loadCopilotSearchIntegrations(context))
    expect(result).toMatchObject({ backend: 'live', accounts: [], available: [{ target }] })
    expect(result.connectionGuidance).toContain('<credential>')
    expect(result).not.toHaveProperty('connectionPath')
    expect(listIntegrations).toHaveBeenCalledWith({
      principal: authorizeChat.mock.calls[0][0].principal,
      input: { organizationId: 'org-1' },
    })
  })

  it('does not read inventory when private-chat authorization fails', async () => {
    authorizeChat.mockRejectedValueOnce(new Error('Chat belongs to another person'))
    await expect(loadCopilotSearchIntegrations(context)).rejects.toThrow(
      'Chat belongs to another person'
    )
    expect(listIntegrations).not.toHaveBeenCalled()
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
