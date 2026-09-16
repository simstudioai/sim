/** @vitest-environment node */
import {
  authMockFns,
  permissionsMock,
  permissionsMockFns,
  resetEnvFlagsMock,
  setEnvFlags,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatStatusEvent } from '@/lib/copilot/chat-status'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { HEARTBEAT_INTERVAL_MS } from '@/lib/events/sse-endpoint'
import { PermissionGroupCapabilityError } from '@/lib/permission-groups/capability-error'

const { authorize, subscribe, unsubscribe } = vi.hoisted(() => ({
  authorize: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
}))
vi.mock('@/lib/copilot/chat/organization-chats', () => ({
  authorizeOrganizationChatEvents: { execute: authorize },
}))
vi.mock('@/lib/copilot/chat-status', () => ({ chatPubSub: { onStatusChanged: subscribe } }))
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

import { GET } from '@/app/api/mothership/events/route'

function request(query: string, signal?: AbortSignal) {
  return new NextRequest(`http://localhost/api/mothership/events?${query}`, { signal })
}

function emit(event: ChatStatusEvent) {
  const handler = subscribe.mock.calls[0][0] as (event: ChatStatusEvent) => void
  handler(event)
}

async function collect(body: ReadableStream<Uint8Array>, chunks: string[]) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  while (true) {
    const { done, value } = await reader.read()
    if (done) return
    chunks.push(decoder.decode(value))
  }
}

describe('Mothership owner-scoped event stream', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    setEnvFlags({ isChatEnabled: true })
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'user-1' },
      session: { id: 'session-1' },
    })
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('read')
    authorize.mockResolvedValue({ organizationId: 'org-1', userId: 'user-1', role: 'member' })
    subscribe.mockReturnValue(unsubscribe)
  })
  afterEach(() => {
    vi.useRealTimers()
    resetEnvFlagsMock()
  })

  it('authenticates before validating scope', async () => {
    authMockFns.mockGetSession.mockResolvedValue(null)
    const response = await GET(request('organizationId=org-1&workspaceId=ws-1'))
    expect(response.status).toBe(401)
    expect(authorize).not.toHaveBeenCalled()
    expect(subscribe).not.toHaveBeenCalled()
  })

  it.each(['', 'workspaceId=', 'organizationId=', 'organizationId=org-1&workspaceId=ws-1'])(
    'refuses absent, empty, or mixed owners: %s',
    async (query) => {
      expect((await GET(request(query))).status).toBe(400)
      expect(subscribe).not.toHaveBeenCalled()
    }
  )

  it('requires chat availability', async () => {
    setEnvFlags({ isChatEnabled: false })
    expect((await GET(request('organizationId=org-1'))).status).toBe(404)
    expect(subscribe).not.toHaveBeenCalled()
  })

  it('refuses a non-member or disabled organization before subscribing', async () => {
    authorize.mockRejectedValue(new OrchestrationError('forbidden', 'Search is not enabled'))
    expect((await GET(request('organizationId=org-1'))).status).toBe(403)
    expect(subscribe).not.toHaveBeenCalled()
  })

  it('maps a permission group capability refusal to 403', async () => {
    authorize.mockRejectedValueOnce(
      new PermissionGroupCapabilityError(
        'copilot.use',
        'PERMISSION_GROUP_CAPABILITY_BLOCKED',
        'Chat is disabled'
      )
    )
    expect((await GET(request('organizationId=org-1'))).status).toBe(403)
    expect(subscribe).not.toHaveBeenCalled()
  })

  it('exposes only the current user’s organization events, without owner metadata', async () => {
    const abort = new AbortController()
    const response = await GET(request('organizationId=org-1', abort.signal))
    expect(response.status).toBe(200)
    const chunks: string[] = []
    const collected = collect(response.body!, chunks)
    emit({
      organizationId: 'org-1',
      userId: 'other-user',
      chatId: 'hidden-user-chat',
      type: 'created',
    })
    emit({ organizationId: 'org-2', userId: 'user-1', chatId: 'hidden-org-chat', type: 'created' })
    emit({ workspaceId: 'ws-1', chatId: 'hidden-workspace-chat', type: 'created' })
    emit({
      organizationId: 'org-1',
      userId: 'user-1',
      chatId: 'visible-chat',
      type: 'completed',
      streamId: 'stream-1',
    })
    await vi.advanceTimersByTimeAsync(0)
    abort.abort()
    await collected
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toContain('visible-chat')
    expect(chunks[0]).toContain('stream-1')
    expect(chunks[0]).not.toMatch(/hidden|userId|organizationId|workspaceId/)
    expect(authorize).toHaveBeenCalledTimes(2)
    expect(authorize).toHaveBeenLastCalledWith({
      principal: { kind: 'session', sessionId: 'session-1', userId: 'user-1' },
      input: { organizationId: 'org-1' },
    })
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('drops a pending event and closes immediately when current authorization fails', async () => {
    const response = await GET(request('organizationId=org-1'))
    const chunks: string[] = []
    const collected = collect(response.body!, chunks)
    authorize.mockRejectedValueOnce(new OrchestrationError('not_found', 'Organization not found'))
    emit({ organizationId: 'org-1', userId: 'user-1', chatId: 'revoked-chat', type: 'renamed' })
    await collected
    expect(chunks).toEqual([])
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('rechecks membership and rollout while idle and releases a revoked connection', async () => {
    const response = await GET(request('organizationId=org-1'))
    const chunks: string[] = []
    const collected = collect(response.body!, chunks)
    authorize.mockRejectedValueOnce(new OrchestrationError('forbidden', 'Search is disabled'))
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS)
    await collected
    expect(chunks).toEqual([])
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('bounds publications waiting on slow authorization and reconciles through reconnect', async () => {
    const response = await GET(request('organizationId=org-1'))
    const chunks: string[] = []
    const collected = collect(response.body!, chunks)
    let authorizeDone: (() => void) | undefined
    authorize.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        authorizeDone = resolve
      })
    )
    for (let index = 0; index < 17; index += 1) {
      emit({ organizationId: 'org-1', userId: 'user-1', chatId: `chat-${index}`, type: 'updated' })
    }
    await collected
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(authorize).toHaveBeenCalledTimes(2)
    authorizeDone?.()
    await vi.advanceTimersByTimeAsync(0)
    expect(chunks).toEqual([])
  })

  it('preserves workspace status events and excludes organization events', async () => {
    const abort = new AbortController()
    const response = await GET(request('workspaceId=ws-1', abort.signal))
    const chunks: string[] = []
    const collected = collect(response.body!, chunks)
    emit({ organizationId: 'org-1', userId: 'user-1', chatId: 'org-chat', type: 'created' })
    emit({ workspaceId: 'ws-2', chatId: 'other-workspace-chat', type: 'created' })
    emit({ workspaceId: 'ws-1', chatId: 'workspace-chat', type: 'renamed' })
    abort.abort()
    await collected
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toContain('workspace-chat')
    expect(chunks[0]).not.toMatch(/org-chat|other-workspace-chat/)
    expect(authorize).not.toHaveBeenCalled()
    expect(authMockFns.mockGetSession).toHaveBeenCalledTimes(1)
  })
})
