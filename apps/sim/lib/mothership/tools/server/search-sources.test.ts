/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  chat: vi.fn(),
  list: vi.fn(),
  providers: vi.fn(),
  approve: vi.fn(),
  authorize: vi.fn(),
  prepare: vi.fn(),
}))
vi.mock('@/lib/mothership/chat/organization-chats', () => ({
  authorizeOrganizationChatDelegation: { execute: mocks.chat },
}))
vi.mock('@/lib/knowledge/application/search-sources', () => ({
  listSearchSources: { execute: mocks.list },
}))
vi.mock('@/lib/knowledge/application/search-integrations', () => ({
  listSearchIntegrations: { execute: mocks.providers },
  approveSearchIntegration: { execute: mocks.approve },
}))
vi.mock('@/lib/knowledge/application/sim-search', () => ({
  prepareSearchSource: { authorize: mocks.authorize, execute: mocks.prepare },
}))
vi.mock('@/lib/sim-search/connectors', () => ({
  SEARCH_SOURCE_TYPES: [
    ['google_drive', { name: 'Google Drive', mirrorsSourceAcls: true }],
    ['gmail', { name: 'Gmail' }],
  ],
  canConnectPersonally: () => true,
}))

import { organizationSearchSourcesServerTool as tool } from '@/lib/mothership/tools/server/search-sources'

const context = {
  userId: 'actual-actor',
  organizationId: 'actual-org',
  chatId: 'actual-chat',
  toolCallId: 'call',
  copilotToolExecution: true,
  requestMode: 'agent',
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.chat.mockResolvedValue({})
  mocks.authorize.mockResolvedValue(undefined)
  mocks.list.mockResolvedValue({ sources: [], nextCursor: 'next' })
  mocks.approve.mockResolvedValue({ connectorType: 'gmail', approved: true, changed: true })
})
describe('Search source direct tool', () => {
  it('uses authenticated actor and org and forwards viewer-safe pagination', async () => {
    expect(await tool.execute({ action: 'list', cursor: 'previous', mine: true }, context)).toEqual(
      { action: 'list', sources: [], nextCursor: 'next' }
    )
    expect(mocks.list).toHaveBeenCalledWith({
      principal: expect.objectContaining({
        kind: 'organization_delegated',
        subjectUserId: 'actual-actor',
        organizationId: 'actual-org',
        audience: 'sim:knowledge',
        resourceScope: { chatId: 'actual-chat' },
      }),
      input: { organizationId: 'actual-org', cursor: 'previous', mine: true },
    })
    expect(mocks.chat).toHaveBeenCalledBefore(mocks.list)
  })
  it('conceals sources not visible to the current actor', async () => {
    await expect(
      tool.execute({ action: 'get', connectorId: 'foreign' }, context)
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.list).toHaveBeenCalledWith(
      expect.objectContaining({ input: { organizationId: 'actual-org', connectorId: 'foreign' } })
    )
  })
  it('returns existing setup UI without creating an index, connecting or changing approval', async () => {
    expect(
      await tool.execute(
        { action: 'setup', connectorType: 'google_drive', accessMode: 'admin' },
        context
      )
    ).toEqual({
      action: 'setup',
      connectorType: 'google_drive',
      name: 'Google Drive',
      accessMode: 'admin',
      setupUrl: '/o/actual-org/settings/integrations?addConnector=google_drive',
      status: 'requires_user_setup',
    })
    expect(mocks.authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        input: { organizationId: 'actual-org', connectorType: 'google_drive', accessMode: 'admin' },
      })
    )
    expect(mocks.prepare).not.toHaveBeenCalled()
    expect(mocks.approve).not.toHaveBeenCalled()
  })
  it('preserves member access in setup URLs', async () => {
    expect(
      await tool.execute(
        { action: 'setup', connectorType: 'gmail', accessMode: 'members' },
        context
      )
    ).toMatchObject({
      setupUrl: '/o/actual-org/settings/integrations?addConnector=gmail&source-access=members',
    })
  })
  it('rejects unsupported provider access modes', async () => {
    await expect(
      tool.execute({ action: 'setup', connectorType: 'gmail', accessMode: 'admin' }, context)
    ).rejects.toMatchObject({ code: 'validation' })
  })
  it('obeys the existing operation denial before returning setup', async () => {
    mocks.authorize.mockRejectedValueOnce(
      new Error('Organization administrator access is required')
    )
    await expect(
      tool.execute({ action: 'setup', connectorType: 'google_drive', accessMode: 'admin' }, context)
    ).rejects.toThrow('administrator')
    expect(mocks.prepare).not.toHaveBeenCalled()
  })
  it('uses the registered approval operation for an explicit decision', async () => {
    await tool.execute({ action: 'approve', connectorType: 'gmail', approved: true }, context)
    expect(mocks.approve).toHaveBeenCalledWith(
      expect.objectContaining({
        input: { organizationId: 'actual-org', connectorType: 'gmail', approved: true },
      })
    )
    expect(mocks.prepare).not.toHaveBeenCalled()
  })
  it.each([
    { workspaceId: 'workspace' },
    { copilotToolExecution: false },
    { requestMode: 'workspace' },
    { requestMode: 'assistant' },
    { chatId: '' },
  ])('refuses invalid conversation context', async (change) => {
    await expect(tool.execute({ action: 'providers' }, { ...context, ...change })).rejects.toThrow()
    expect(mocks.chat).not.toHaveBeenCalled()
    expect(mocks.providers).not.toHaveBeenCalled()
  })
  it('stops before source operations when current private chat access is revoked', async () => {
    mocks.chat.mockRejectedValueOnce(new Error('Conversation not found'))
    await expect(
      tool.execute({ action: 'approve', connectorType: 'gmail', approved: true }, context)
    ).rejects.toThrow('Conversation not found')
    expect(mocks.approve).not.toHaveBeenCalled()
  })
  it('rejects model-supplied scope and credentials', () => {
    expect(tool.inputSchema!.safeParse({ action: 'list', organizationId: 'forged' }).success).toBe(
      false
    )
    expect(
      tool.inputSchema!.safeParse({
        action: 'setup',
        connectorType: 'google_drive',
        accessMode: 'admin',
        token: 'secret',
      }).success
    ).toBe(false)
  })
})
