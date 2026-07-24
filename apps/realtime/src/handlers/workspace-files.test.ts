/**
 * @vitest-environment node
 */
import { ROOM_TYPES } from '@sim/realtime-protocol/rooms'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IRoomManager } from '@/rooms'

const { mockAuthorizeRoom } = vi.hoisted(() => ({
  mockAuthorizeRoom: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: { select: vi.fn() },
  user: { image: 'image' },
}))

vi.mock('@sim/platform-authz/rooms', () => ({
  authorizeRoom: mockAuthorizeRoom,
}))

import { setupWorkspaceFilesHandlers } from '@/handlers/workspace-files'

interface JoinPayload {
  workspaceId: string
  folderId?: string | null
  tabSessionId?: string
}

function createSocket(overrides?: Record<string, unknown>) {
  const handlers: Record<string, (payload: JoinPayload) => Promise<void> | void> = {}
  const socket = {
    id: 'socket-1',
    userId: 'user-1',
    userName: 'Test User',
    userImage: 'avatar.png',
    on: vi.fn((event: string, handler: (payload: JoinPayload) => Promise<void> | void) => {
      handlers[event] = handler
    }),
    emit: vi.fn(),
    join: vi.fn(),
    leave: vi.fn(),
    to: vi.fn().mockReturnValue({ emit: vi.fn() }),
    ...overrides,
  }
  return { handlers, socket }
}

function createRoomManager(overrides?: Partial<IRoomManager>): IRoomManager {
  return {
    isReady: vi.fn().mockReturnValue(true),
    getRoomForSocket: vi.fn().mockResolvedValue(null),
    getRoomsForSocket: vi.fn().mockResolvedValue([]),
    removeUserFromRoom: vi.fn().mockResolvedValue(false),
    removeSocketFromAllRooms: vi.fn().mockResolvedValue([]),
    broadcastPresenceUpdate: vi.fn().mockResolvedValue(undefined),
    getRoomUsers: vi.fn().mockResolvedValue([]),
    hasRoom: vi.fn().mockResolvedValue(false),
    deleteRoom: vi.fn().mockResolvedValue(undefined),
    addUserToRoom: vi.fn().mockResolvedValue(undefined),
    getUserSession: vi.fn().mockResolvedValue(null),
    updateUserActivity: vi.fn().mockResolvedValue(undefined),
    updateRoomLastModified: vi.fn().mockResolvedValue(undefined),
    emitToRoom: vi.fn(),
    getUniqueUserCount: vi.fn().mockResolvedValue(1),
    getTotalActiveConnections: vi.fn().mockResolvedValue(0),
    shutdown: vi.fn().mockResolvedValue(undefined),
    initialize: vi.fn().mockResolvedValue(undefined),
    io: {
      in: vi.fn().mockReturnValue({ socketsLeave: vi.fn().mockResolvedValue(undefined) }),
    },
    ...overrides,
  } as unknown as IRoomManager
}

describe('setupWorkspaceFilesHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthorizeRoom.mockResolvedValue({
      allowed: true,
      status: 200,
      workspaceId: 'ws-1',
      workspacePermission: 'admin',
    })
  })

  it('rejects join when the socket is not authenticated', async () => {
    const { socket, handlers } = createSocket({ userId: undefined, userName: undefined })
    setupWorkspaceFilesHandlers(
      socket as unknown as Parameters<typeof setupWorkspaceFilesHandlers>[0],
      createRoomManager()
    )

    await handlers['join-workspace-files']({ workspaceId: 'ws-1' })

    expect(socket.emit).toHaveBeenCalledWith('join-workspace-files-error', {
      workspaceId: 'ws-1',
      error: 'Authentication required',
      code: 'AUTHENTICATION_REQUIRED',
      retryable: false,
    })
  })

  it('rejects join with a retryable error when realtime is unavailable', async () => {
    const { socket, handlers } = createSocket()
    setupWorkspaceFilesHandlers(
      socket as unknown as Parameters<typeof setupWorkspaceFilesHandlers>[0],
      createRoomManager({ isReady: vi.fn().mockReturnValue(false) })
    )

    await handlers['join-workspace-files']({ workspaceId: 'ws-1' })

    expect(socket.emit).toHaveBeenCalledWith(
      'join-workspace-files-error',
      expect.objectContaining({ code: 'ROOM_MANAGER_UNAVAILABLE', retryable: true })
    )
  })

  it('rejects join when workspace access is denied', async () => {
    mockAuthorizeRoom.mockResolvedValue({
      allowed: false,
      status: 403,
      workspaceId: 'ws-1',
      workspacePermission: null,
    })
    const { socket, handlers } = createSocket()
    setupWorkspaceFilesHandlers(
      socket as unknown as Parameters<typeof setupWorkspaceFilesHandlers>[0],
      createRoomManager()
    )

    await handlers['join-workspace-files']({ workspaceId: 'ws-1' })

    expect(socket.emit).toHaveBeenCalledWith(
      'join-workspace-files-error',
      expect.objectContaining({ code: 'ACCESS_DENIED', retryable: false })
    )
  })

  it('joins the workspace files room and broadcasts presence on success', async () => {
    const { socket, handlers } = createSocket()
    const roomManager = createRoomManager({
      getRoomUsers: vi.fn().mockResolvedValue([]),
    })
    setupWorkspaceFilesHandlers(
      socket as unknown as Parameters<typeof setupWorkspaceFilesHandlers>[0],
      roomManager
    )

    await handlers['join-workspace-files']({
      workspaceId: 'ws-1',
      folderId: 'folder-1',
      tabSessionId: 'tab-1',
    })

    expect(socket.join).toHaveBeenCalledWith('workspace-files:ws-1')
    expect(roomManager.addUserToRoom).toHaveBeenCalledWith(
      { type: ROOM_TYPES.WORKSPACE_FILES, id: 'ws-1' },
      'socket-1',
      expect.objectContaining({ userId: 'user-1', folderId: 'folder-1', role: 'admin' })
    )
    expect(socket.emit).toHaveBeenCalledWith(
      'join-workspace-files-success',
      expect.objectContaining({ workspaceId: 'ws-1', socketId: 'socket-1' })
    )
    expect(roomManager.broadcastPresenceUpdate).toHaveBeenCalledWith({
      type: ROOM_TYPES.WORKSPACE_FILES,
      id: 'ws-1',
    })
  })
})
