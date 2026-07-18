import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockBuildPayload = vi.fn()
const mockGenerateSnapshot = vi.fn()
const mockPermissions = vi.fn()
const mockEntitlements = vi.fn()
const mockDecryptedEnv = vi.fn()
const mockBilling = vi.fn()
const mockRunHeadless = vi.fn()

vi.mock('@/lib/copilot/chat/payload', () => ({
  buildCopilotRequestPayload: (...args: unknown[]) => mockBuildPayload(...args),
}))

vi.mock('@/lib/copilot/chat/workspace-context', () => ({
  generateWorkspaceSnapshot: (...args: unknown[]) => mockGenerateSnapshot(...args),
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getUserEntityPermissions: (...args: unknown[]) => mockPermissions(...args),
}))

vi.mock('@/lib/copilot/entitlements', () => ({
  computeWorkspaceEntitlements: (...args: unknown[]) => mockEntitlements(...args),
}))

vi.mock('@/lib/environment/utils', () => ({
  getEffectiveDecryptedEnv: (...args: unknown[]) => mockDecryptedEnv(...args),
}))

vi.mock('@/lib/billing/core/billing-attribution', () => ({
  resolveBillingAttribution: (...args: unknown[]) => mockBilling(...args),
}))

vi.mock('@/lib/copilot/request/lifecycle/headless', () => ({
  runHeadlessCopilotLifecycle: (...args: unknown[]) => mockRunHeadless(...args),
}))

vi.mock('@sim/utils/id', () => ({
  generateId: () => 'msg-demo-1',
}))

import {
  DEMO_MOTHERSHIP_CHAT_TYPE,
  prepareDemoBackendRequest,
  prepareDemoFrontendRequest,
  prepareDemoMothershipRequest,
  runDemoFrontendPass,
  runDemoMothershipPass,
} from '@/lib/apps/demo/headless-mothership'

describe('prepareDemoBackendRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGenerateSnapshot.mockResolvedValue({ markdown: 'ws', snapshot: { version: 1 } })
    mockPermissions.mockResolvedValue('admin')
    mockEntitlements.mockResolvedValue([])
    mockDecryptedEnv.mockResolvedValue({})
    mockBilling.mockResolvedValue({ actorUserId: 'user-1', workspaceId: 'ws-1' })
    mockBuildPayload.mockResolvedValue({ message: 'hi' })
    mockRunHeadless.mockResolvedValue({
      success: true,
      content: '',
      contentBlocks: [],
      toolCalls: [],
    })
  })

  it('stamps chatType mothership and propagates userPermission into execution context', async () => {
    const prepared = await prepareDemoBackendRequest({
      userId: 'user-1',
      workspaceId: 'ws-1',
      chatId: 'chat-1',
      message: 'build backends',
      mode: 'agent',
      appProject: {
        id: 'proj-1',
        name: 'Demo',
        slug: 'demo',
        publicId: 'pub',
        draftRevisionId: null,
        publishedReleaseId: null,
      },
    })

    expect(DEMO_MOTHERSHIP_CHAT_TYPE).toBe('mothership')
    expect(prepared.requestPayload.chatType).toBe('mothership')
    expect(prepared.requestPayload.chatType).not.toBe('fullstack')
    expect(prepared.requestPayload.appProject).toEqual(expect.objectContaining({ id: 'proj-1' }))
    expect(prepared.executionContext.requestMode).toBe('agent')
    expect(prepared.executionContext.userPermission).toBe('admin')
    expect(mockBuildPayload).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'agent',
        model: 'claude-opus-4-8',
        chatId: 'chat-1',
        userPermission: 'admin',
        workspaceContext: 'ws',
      }),
      expect.objectContaining({ selectedModel: 'claude-opus-4-8' })
    )
  })

  it('keeps prepareDemoMothershipRequest as a backend alias', async () => {
    const prepared = await prepareDemoMothershipRequest({
      userId: 'user-1',
      workspaceId: 'ws-1',
      chatId: 'chat-1',
      message: 'build backends',
      mode: 'agent',
    })
    expect(prepared.requestPayload.chatType).toBe('mothership')
  })

  it('runs server-owned passes as non-interactive so workflow tools never wait for a browser', async () => {
    await runDemoMothershipPass({
      userId: 'user-1',
      workspaceId: 'ws-1',
      chatId: 'chat-1',
      message: 'build backends',
      mode: 'agent',
    })

    expect(mockRunHeadless).toHaveBeenCalledWith(
      expect.objectContaining({ chatType: 'mothership' }),
      expect.objectContaining({
        goRoute: '/api/mothership',
        interactive: false,
        executionContext: expect.objectContaining({ userPermission: 'admin' }),
      })
    )
  })
})

describe('prepareDemoFrontendRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPermissions.mockResolvedValue('write')
    mockDecryptedEnv.mockResolvedValue({})
    mockBilling.mockResolvedValue({ actorUserId: 'user-1', workspaceId: 'ws-1' })
    mockBuildPayload.mockResolvedValue({
      message: 'ui',
      chatId: 'should-be-stripped',
      vfs: { version: 1 },
      workspaceContext: 'nope',
      integrationTools: [{ name: 'slack_list_users' }],
      mothershipTools: [{ name: 'create_workflow' }],
      chatType: 'mothership',
      appProject: { id: 'x' },
    })
    mockRunHeadless.mockResolvedValue({
      success: true,
      content: '{"files":[]}',
      contentBlocks: [],
      toolCalls: [],
    })
  })

  it('builds a stateless tool-less payload without chat/VFS/tools/appProject', async () => {
    const prepared = await prepareDemoFrontendRequest({
      userId: 'user-1',
      workspaceId: 'ws-1',
      message: 'build ui',
    })

    expect(mockGenerateSnapshot).not.toHaveBeenCalled()
    expect(mockBuildPayload).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'ask',
        model: 'claude-opus-4-8',
        userPermission: 'write',
      }),
      expect.anything()
    )
    expect(mockBuildPayload.mock.calls[0]?.[0]).not.toHaveProperty('chatId')
    expect(mockBuildPayload.mock.calls[0]?.[0]).not.toHaveProperty('vfs')
    expect(mockBuildPayload.mock.calls[0]?.[0]).not.toHaveProperty('workspaceContext')

    expect(prepared.requestPayload.chatId).toBeUndefined()
    expect(prepared.requestPayload.vfs).toBeUndefined()
    expect(prepared.requestPayload.workspaceContext).toBeUndefined()
    expect(prepared.requestPayload.appProject).toBeUndefined()
    expect(prepared.requestPayload.integrationTools).toBeUndefined()
    expect(prepared.requestPayload.mothershipTools).toBeUndefined()
    expect(prepared.requestPayload.chatType).toBeUndefined()
    expect(prepared.executionContext.chatId).toBeUndefined()
    expect(prepared.executionContext.userPermission).toBe('write')
  })

  it('runs frontend pass without a chatId lifecycle option', async () => {
    await runDemoFrontendPass({
      userId: 'user-1',
      workspaceId: 'ws-1',
      message: 'build ui',
    })

    expect(mockRunHeadless).toHaveBeenCalledWith(
      expect.not.objectContaining({ chatType: 'mothership' }),
      expect.objectContaining({
        interactive: false,
        goRoute: '/api/mothership',
      })
    )
    const lifecycleOpts = mockRunHeadless.mock.calls[0]?.[1] as Record<string, unknown>
    expect(lifecycleOpts.chatId).toBeUndefined()
  })
})
