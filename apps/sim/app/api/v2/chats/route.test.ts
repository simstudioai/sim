/**
 * @vitest-environment node
 */
import {
  dbChainMockFns,
  flattenMockConditions,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckRateLimit,
  mockEnvFlags,
  mockReconcileChatStreamMarkers,
  mockResolveWorkspaceAccess,
  mockV2ApiGateError,
} = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockEnvFlags: { isAuthDisabled: false },
  mockReconcileChatStreamMarkers: vi.fn(),
  mockResolveWorkspaceAccess: vi.fn(),
  mockV2ApiGateError: vi.fn(),
}))

vi.mock('@/app/api/v1/middleware', () => ({
  checkRateLimit: mockCheckRateLimit,
  resolveWorkspaceAccess: mockResolveWorkspaceAccess,
}))

vi.mock('@/app/api/v2/lib/gate', () => ({
  v2ApiGateError: mockV2ApiGateError,
}))

vi.mock('@/lib/copilot/chat/stream-liveness', () => ({
  reconcileChatStreamMarkers: mockReconcileChatStreamMarkers,
}))

vi.mock('@/lib/core/config/env-flags', () => mockEnvFlags)

import { GET } from '@/app/api/v2/chats/route'

const RATE_LIMIT = {
  allowed: true,
  userId: 'user-1',
  keyType: 'personal' as const,
  limit: 100,
  remaining: 99,
  resetAt: new Date('2026-08-07T13:00:00.000Z'),
}

function buildChat(overrides: Record<string, unknown> = {}) {
  return {
    id: 'chat-1',
    title: 'Release plan',
    updatedAt: new Date('2026-08-07T12:00:00.000Z'),
    pinned: true,
    activeStreamId: 'stream-stale',
    ...overrides,
  }
}

function callList(query = 'workspaceId=workspace-1') {
  return GET(new NextRequest(`http://localhost:3000/api/v2/chats?${query}`))
}

describe('GET /api/v2/chats', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockEnvFlags.isAuthDisabled = false
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT)
    mockV2ApiGateError.mockResolvedValue(null)
    mockResolveWorkspaceAccess.mockResolvedValue(null)
    mockReconcileChatStreamMarkers.mockImplementation(
      async (candidates: Array<{ chatId: string; streamId: string | null }>) =>
        new Map(
          candidates.map((candidate) => [
            candidate.chatId,
            {
              chatId: candidate.chatId,
              streamId: candidate.streamId,
              status: candidate.streamId ? 'active' : 'inactive',
            },
          ])
        )
    )
  })

  it('rejects workspace keys before reading private chat history', async () => {
    mockCheckRateLimit.mockResolvedValue({ ...RATE_LIMIT, keyType: 'workspace' })

    const response = await callList()

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      error: {
        code: 'FORBIDDEN',
        message: 'Chat history requires a personal API key',
      },
    })
    expect(mockResolveWorkspaceAccess).not.toHaveBeenCalled()
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })

  it('returns the workspace-access failure without querying chats', async () => {
    mockResolveWorkspaceAccess.mockResolvedValue({
      status: 403,
      code: 'FORBIDDEN',
      message: 'Access denied',
    })

    const response = await callList()

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      error: { code: 'FORBIDDEN', message: 'Access denied' },
    })
    expect(mockResolveWorkspaceAccess).toHaveBeenCalledWith(
      RATE_LIMIT,
      'user-1',
      'workspace-1',
      'read'
    )
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })

  it('treats the auth-disabled principal like a session principal for workspace access', async () => {
    mockEnvFlags.isAuthDisabled = true
    queueTableRows(schemaMock.copilotChats, [])

    const response = await callList()

    expect(response.status).toBe(200)
    expect(mockResolveWorkspaceAccess).toHaveBeenCalledWith(
      expect.objectContaining({ keyType: undefined }),
      'user-1',
      'workspace-1',
      'read'
    )
  })

  it('bounds the SQL page, maps summaries, and derives active state from the live marker', async () => {
    queueTableRows(schemaMock.copilotChats, [
      buildChat(),
      buildChat({
        id: 'chat-2',
        title: null,
        updatedAt: new Date('2026-08-06T12:00:00.000Z'),
        pinned: false,
        activeStreamId: 'stream-live',
      }),
      buildChat({ id: 'chat-3' }),
    ])
    mockReconcileChatStreamMarkers.mockResolvedValueOnce(
      new Map([
        ['chat-1', { chatId: 'chat-1', streamId: null, status: 'inactive' }],
        ['chat-2', { chatId: 'chat-2', streamId: 'stream-live', status: 'active' }],
      ])
    )

    const response = await callList('workspaceId=workspace-1&limit=2')
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toEqual([
      {
        id: 'chat-1',
        title: 'Release plan',
        updatedAt: '2026-08-07T12:00:00.000Z',
        pinned: true,
        active: false,
      },
      {
        id: 'chat-2',
        title: null,
        updatedAt: '2026-08-06T12:00:00.000Z',
        pinned: false,
        active: true,
      },
    ])
    expect(body.nextCursor).toEqual(expect.any(String))
    expect(dbChainMockFns.limit).toHaveBeenCalledWith(3)
    expect(mockReconcileChatStreamMarkers).toHaveBeenCalledWith(
      [
        { chatId: 'chat-1', streamId: 'stream-stale' },
        { chatId: 'chat-2', streamId: 'stream-live' },
      ],
      { repairVerifiedStaleMarkers: true }
    )
  })

  it('replays its opaque cursor as a keyset bound', async () => {
    queueTableRows(schemaMock.copilotChats, [buildChat(), buildChat({ id: 'chat-2' })])
    const first = await callList('workspaceId=workspace-1&limit=1')
    const { nextCursor } = await first.json()

    queueTableRows(schemaMock.copilotChats, [
      buildChat({
        id: 'chat-2',
        title: 'Older chat',
        updatedAt: new Date('2026-08-06T12:00:00.000Z'),
        pinned: false,
        activeStreamId: null,
      }),
    ])
    const second = await callList(
      `workspaceId=workspace-1&limit=1&cursor=${encodeURIComponent(nextCursor)}`
    )

    expect(second.status).toBe(200)
    const conditions = flattenMockConditions(dbChainMockFns.where.mock.calls.at(-1)?.[0])
    expect(conditions.some((condition) => condition?.type === 'or')).toBe(true)
  })

  it('rejects a malformed cursor instead of restarting at the first page', async () => {
    const response = await callList('workspaceId=workspace-1&cursor=not-a-cursor')

    expect(response.status).toBe(400)
    expect((await response.json()).error.message).toMatch(/cursor does not match/i)
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })
})
