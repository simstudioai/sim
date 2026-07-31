/**
 * @vitest-environment node
 */
import { copilotHttpMock, copilotHttpMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockSelect,
  mockFrom,
  mockWhere,
  mockLimit,
  mockParseRequest,
  mockGetAccessibleChat,
  mockGetPermission,
  mockTrackChatUpload,
} = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockFrom: vi.fn(),
  mockWhere: vi.fn(),
  mockLimit: vi.fn(),
  mockParseRequest: vi.fn(),
  mockGetAccessibleChat: vi.fn(),
  mockGetPermission: vi.fn(),
  mockTrackChatUpload: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: { select: mockSelect },
}))

vi.mock('@sim/db/schema', () => ({
  workspaceFiles: {
    key: 'workspaceFiles.key',
    userId: 'workspaceFiles.userId',
    workspaceId: 'workspaceFiles.workspaceId',
    context: 'workspaceFiles.context',
    chatId: 'workspaceFiles.chatId',
    displayName: 'workspaceFiles.displayName',
    originalName: 'workspaceFiles.originalName',
    contentType: 'workspaceFiles.contentType',
    size: 'workspaceFiles.size',
    deletedAt: 'workspaceFiles.deletedAt',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ type: 'and', conditions })),
  eq: vi.fn((field: unknown, value: unknown) => ({ type: 'eq', field, value })),
  isNull: vi.fn((field: unknown) => ({ type: 'isNull', field })),
}))

vi.mock('@/lib/copilot/request/http', () => copilotHttpMock)
vi.mock('@/lib/api/server', () => ({ parseRequest: mockParseRequest }))
vi.mock('@/lib/api/contracts/mothership-chats', () => ({ stageLocalFileUploadContract: {} }))
vi.mock('@/lib/copilot/chat/lifecycle', () => ({
  getAccessibleCopilotChatAuth: mockGetAccessibleChat,
}))
vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getUserEntityPermissions: mockGetPermission,
}))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  trackChatUpload: mockTrackChatUpload,
}))

import { POST } from '@/app/api/mothership/local-files/stage/route'

function request() {
  return new NextRequest('http://localhost:3000/api/mothership/local-files/stage', {
    method: 'POST',
    body: JSON.stringify({ workspaceId: 'ws-1', chatId: 'chat-1', key: 'storage-key' }),
  })
}

describe('POST /api/mothership/local-files/stage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    copilotHttpMockFns.mockAuthenticateCopilotRequestSessionOnly.mockResolvedValue({
      userId: 'user-1',
      isAuthenticated: true,
    })
    mockParseRequest.mockResolvedValue({
      success: true,
      data: { body: { workspaceId: 'ws-1', chatId: 'chat-1', key: 'storage-key' } },
    })
    mockGetAccessibleChat.mockResolvedValue({
      id: 'chat-1',
      workspaceId: 'ws-1',
      type: 'mothership',
    })
    mockGetPermission.mockResolvedValue('write')
    mockLimit.mockResolvedValue([
      {
        chatId: null,
        displayName: null,
        originalName: 'report.pdf',
        contentType: 'application/pdf',
        size: 42,
      },
    ])
    mockWhere.mockReturnValue({ limit: mockLimit })
    mockFrom.mockReturnValue({ where: mockWhere })
    mockSelect.mockReturnValue({ from: mockFrom })
    mockTrackChatUpload.mockResolvedValue({ displayName: 'report.pdf' })
  })

  it('links only the authenticated user upload to the active chat', async () => {
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      success: true,
      displayName: 'report.pdf',
      fileName: 'report.pdf',
      uploadPath: 'uploads/report.pdf',
    })
    expect(mockTrackChatUpload).toHaveBeenCalledWith(
      'ws-1',
      'user-1',
      'chat-1',
      'storage-key',
      'report.pdf',
      'application/pdf',
      42
    )
  })

  it('rejects a chat from another workspace before reading upload metadata', async () => {
    mockGetAccessibleChat.mockResolvedValue({ id: 'chat-1', workspaceId: 'ws-other' })
    const response = await POST(request())

    expect(response.status).toBe(404)
    expect(mockSelect).not.toHaveBeenCalled()
  })

  it('is idempotent when the upload is already linked to this chat', async () => {
    mockLimit.mockResolvedValue([
      {
        chatId: 'chat-1',
        displayName: 'report (2).pdf',
        originalName: 'report.pdf',
        contentType: 'application/pdf',
        size: 42,
      },
    ])
    const response = await POST(request())

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      fileName: 'report (2).pdf',
      uploadPath: 'uploads/report%20(2).pdf',
    })
    expect(mockTrackChatUpload).not.toHaveBeenCalled()
  })
})
