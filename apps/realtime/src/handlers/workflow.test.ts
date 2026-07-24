/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IRoomManager } from '@/rooms'

const { mockGetWorkflowState, mockVerifyWorkflowAccess, mockResolveCurrentWorkflowRole } =
  vi.hoisted(() => ({
    mockGetWorkflowState: vi.fn(),
    mockVerifyWorkflowAccess: vi.fn(),
    mockResolveCurrentWorkflowRole: vi.fn(),
  }))

vi.mock('@sim/db', () => ({
  db: { select: vi.fn() },
  user: { image: 'image' },
}))

vi.mock('@/database/operations', () => ({
  getWorkflowState: mockGetWorkflowState,
}))

vi.mock('@/middleware/permissions', () => ({
  verifyWorkflowAccess: mockVerifyWorkflowAccess,
  resolveCurrentWorkflowRole: mockResolveCurrentWorkflowRole,
}))

import { setupWorkflowHandlers } from '@/handlers/workflow'

interface JoinWorkflowPayload {
  workflowId: string
  tabSessionId?: string
}

function createSocket(overrides?: Partial<Record<string, unknown>>) {
  const handlers: Record<string, (payload: JoinWorkflowPayload) => Promise<void> | void> = {}
  const socket = {
    id: 'socket-1',
    userId: 'user-1',
    userName: 'Test User',
    userImage: 'avatar.png',
    on: vi.fn((event: string, handler: (payload: JoinWorkflowPayload) => Promise<void> | void) => {
      handlers[event] = handler
    }),
    emit: vi.fn(),
    join: vi.fn(),
    leave: vi.fn(),
    ...overrides,
  }

  return {
    handlers,
    socket,
  }
}

function createRoomManager(overrides?: Partial<IRoomManager>): IRoomManager {
  return {
    isReady: vi.fn().mockReturnValue(true),
    getWorkflowIdForSocket: vi.fn().mockResolvedValue(null),
    removeUserFromRoom: vi.fn().mockResolvedValue(null),
    broadcastPresenceUpdate: vi.fn().mockResolvedValue(undefined),
    getWorkflowUsers: vi.fn().mockResolvedValue([]),
    hasWorkflowRoom: vi.fn().mockResolvedValue(false),
    addUserToRoom: vi.fn().mockResolvedValue(undefined),
    getUserSession: vi.fn().mockResolvedValue(null),
    updateUserActivity: vi.fn().mockResolvedValue(undefined),
    updateRoomLastModified: vi.fn().mockResolvedValue(undefined),
    emitToWorkflow: vi.fn(),
    getUniqueUserCount: vi.fn().mockResolvedValue(1),
    getTotalActiveConnections: vi.fn().mockResolvedValue(0),
    handleWorkflowDeletion: vi.fn().mockResolvedValue(undefined),
    handleWorkflowRevert: vi.fn().mockResolvedValue(undefined),
    handleWorkflowUpdate: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
    initialize: vi.fn().mockResolvedValue(undefined),
    io: {
      in: vi.fn().mockReturnValue({
        fetchSockets: vi.fn().mockResolvedValue([]),
        socketsLeave: vi.fn().mockResolvedValue(undefined),
      }),
    },
    ...overrides,
  } as unknown as IRoomManager
}

describe('setupWorkflowHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetWorkflowState.mockResolvedValue({ id: 'workflow-1', state: {} })
    mockVerifyWorkflowAccess.mockResolvedValue({ hasAccess: true, role: 'admin' })
    mockResolveCurrentWorkflowRole.mockResolvedValue('admin')
  })

  it('includes workflowId when authentication is missing', async () => {
    const { socket, handlers } = createSocket({ userId: undefined, userName: undefined })
    const roomManager = createRoomManager()

    setupWorkflowHandlers(
      socket as unknown as Parameters<typeof setupWorkflowHandlers>[0],
      roomManager
    )

    await handlers['join-workflow']({ workflowId: 'workflow-1', tabSessionId: 'tab-1' })

    expect(socket.emit).toHaveBeenCalledWith('join-workflow-error', {
      workflowId: 'workflow-1',
      error: 'Authentication required',
      code: 'AUTHENTICATION_REQUIRED',
      retryable: false,
    })
  })

  it('includes workflowId when realtime is unavailable', async () => {
    const { socket, handlers } = createSocket()
    const roomManager = createRoomManager({
      isReady: vi.fn().mockReturnValue(false),
    })

    setupWorkflowHandlers(
      socket as unknown as Parameters<typeof setupWorkflowHandlers>[0],
      roomManager
    )

    await handlers['join-workflow']({ workflowId: 'workflow-1', tabSessionId: 'tab-1' })

    expect(socket.emit).toHaveBeenCalledWith('join-workflow-error', {
      workflowId: 'workflow-1',
      error: 'Realtime unavailable',
      code: 'ROOM_MANAGER_UNAVAILABLE',
      retryable: true,
    })
  })

  it('includes workflowId when access is denied', async () => {
    mockVerifyWorkflowAccess.mockResolvedValue({ hasAccess: false })

    const { socket, handlers } = createSocket()
    const roomManager = createRoomManager()

    setupWorkflowHandlers(
      socket as unknown as Parameters<typeof setupWorkflowHandlers>[0],
      roomManager
    )

    await handlers['join-workflow']({ workflowId: 'workflow-1', tabSessionId: 'tab-1' })

    expect(socket.emit).toHaveBeenCalledWith('join-workflow-error', {
      workflowId: 'workflow-1',
      error: 'Access denied to workflow',
      code: 'ACCESS_DENIED',
      retryable: false,
    })
  })

  it('denies the join when access is revoked while the join is in flight', async () => {
    mockResolveCurrentWorkflowRole.mockResolvedValue(null)

    const { socket, handlers } = createSocket()
    const roomManager = createRoomManager()

    setupWorkflowHandlers(
      socket as unknown as Parameters<typeof setupWorkflowHandlers>[0],
      roomManager
    )

    await handlers['join-workflow']({ workflowId: 'workflow-1', tabSessionId: 'tab-1' })

    expect(socket.emit).toHaveBeenCalledWith('join-workflow-error', {
      workflowId: 'workflow-1',
      error: 'Access denied to workflow',
      code: 'ACCESS_DENIED',
      retryable: false,
    })
    expect(socket.join).not.toHaveBeenCalled()
    expect(roomManager.addUserToRoom).not.toHaveBeenCalled()
  })

  it('joins with the re-validated role, passing the join-time role as fallback', async () => {
    mockVerifyWorkflowAccess.mockResolvedValue({ hasAccess: true, role: 'write' })
    mockResolveCurrentWorkflowRole.mockResolvedValue('read')

    const { socket, handlers } = createSocket()
    const roomManager = createRoomManager()

    setupWorkflowHandlers(
      socket as unknown as Parameters<typeof setupWorkflowHandlers>[0],
      roomManager
    )

    await handlers['join-workflow']({ workflowId: 'workflow-1', tabSessionId: 'tab-1' })

    expect(mockResolveCurrentWorkflowRole).toHaveBeenCalledWith('user-1', 'workflow-1', 'write')
    expect(socket.join).toHaveBeenCalledWith('workflow-1')
    expect(roomManager.addUserToRoom).toHaveBeenCalledWith(
      'workflow-1',
      'socket-1',
      expect.objectContaining({ role: 'read' })
    )
  })

  it('marks workflow access verification failures as retryable', async () => {
    mockVerifyWorkflowAccess.mockRejectedValue(new Error('database unavailable'))

    const { socket, handlers } = createSocket()
    const roomManager = createRoomManager()

    setupWorkflowHandlers(
      socket as unknown as Parameters<typeof setupWorkflowHandlers>[0],
      roomManager
    )

    await handlers['join-workflow']({ workflowId: 'workflow-1', tabSessionId: 'tab-1' })

    expect(socket.emit).toHaveBeenCalledWith('join-workflow-error', {
      workflowId: 'workflow-1',
      error: 'Failed to verify workflow access',
      code: 'VERIFY_WORKFLOW_ACCESS_FAILED',
      retryable: true,
    })
  })

  it('includes workflowId when an unexpected join failure occurs', async () => {
    const { socket, handlers } = createSocket()
    const roomManager = createRoomManager({
      getWorkflowIdForSocket: vi.fn().mockRejectedValue(new Error('boom')),
      removeUserFromRoom: vi.fn().mockResolvedValue(null),
    })

    setupWorkflowHandlers(
      socket as unknown as Parameters<typeof setupWorkflowHandlers>[0],
      roomManager
    )

    await handlers['join-workflow']({ workflowId: 'workflow-1', tabSessionId: 'tab-1' })

    expect(socket.emit).toHaveBeenCalledWith('join-workflow-error', {
      workflowId: 'workflow-1',
      error: 'Failed to join workflow',
      code: 'JOIN_WORKFLOW_FAILED',
      retryable: true,
    })
  })
})
