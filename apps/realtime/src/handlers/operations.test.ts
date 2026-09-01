/**
 * @vitest-environment node
 *
 * End-to-end guard for the socket operation ACL: the security boundary is not the
 * role table on its own but whether a role reaches `persistWorkflowOperation`.
 * These tests drive the real handler with the real permission middleware (only the
 * database and the workspace authorizer are mocked) and assert on the persist call,
 * because that is what durably rewrites `workflow_blocks`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IRoomManager } from '@/rooms'

const { mockAuthorizeWorkflow, mockPersist, mockAssertMutable } = vi.hoisted(() => ({
  mockAuthorizeWorkflow: vi.fn(),
  mockPersist: vi.fn(),
  mockAssertMutable: vi.fn(),
}))

vi.mock('@sim/platform-authz/workflow', () => ({
  authorizeWorkflowByWorkspacePermission: mockAuthorizeWorkflow,
  assertWorkflowMutable: mockAssertMutable,
  WorkflowLockedError: class WorkflowLockedError extends Error {},
}))

vi.mock('@/database/operations', () => ({
  persistWorkflowOperation: mockPersist,
}))

import { setupOperationsHandlers } from '@/handlers/operations'

const WORKFLOW_ID = 'wf-acl'
const BLOCK_ID = 'block-1'

type Handler = (payload: unknown) => Promise<void> | void

function createSocket(id: string) {
  const handlers: Record<string, Handler> = {}
  const toEmit = vi.fn()
  const socket = {
    id,
    userId: `user-${id}`,
    userName: 'Test User',
    on: vi.fn((event: string, handler: Handler) => {
      handlers[event] = handler
    }),
    emit: vi.fn(),
    to: vi.fn().mockReturnValue({ emit: toEmit }),
  }
  return { socket, handlers, toEmit }
}

function createRoomManager(socketId: string, role: string): IRoomManager {
  return {
    isReady: () => true,
    getRoomForSocket: vi.fn().mockResolvedValue({ type: 'workflow', id: WORKFLOW_ID }),
    getUserSession: vi
      .fn()
      .mockResolvedValue({ userId: `user-${socketId}`, userName: 'Test User' }),
    hasRoom: vi.fn().mockResolvedValue(true),
    getRoomUsers: vi.fn().mockResolvedValue([{ socketId, userId: `user-${socketId}`, role }]),
    updateUserActivity: vi.fn().mockResolvedValue(undefined),
    updateRoomLastModified: vi.fn().mockResolvedValue(undefined),
  } as unknown as IRoomManager
}

/** A committed single-block move — the form that writes `workflow_blocks`. */
function committedPositionUpdate() {
  return {
    operationId: 'op-1',
    operation: 'update-position',
    target: 'block',
    timestamp: Date.now(),
    payload: { id: BLOCK_ID, position: { x: 999_999, y: 999_999 }, commit: true },
  }
}

/** The batch form, which persists with no `commit` flag at all. */
function batchPositionUpdate() {
  return {
    operationId: 'op-2',
    operation: 'batch-update-positions',
    target: 'blocks',
    timestamp: Date.now(),
    payload: { updates: [{ id: BLOCK_ID, position: { x: 1, y: 2 } }] },
  }
}

function setup(id: string, role: string) {
  const { socket, handlers, toEmit } = createSocket(id)
  setupOperationsHandlers(
    socket as unknown as Parameters<typeof setupOperationsHandlers>[0],
    createRoomManager(id, role)
  )
  return { socket, handlers, toEmit }
}

describe('workflow operation ACL', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAssertMutable.mockResolvedValue(undefined)
    mockPersist.mockResolvedValue(undefined)
  })

  describe('read-only member', () => {
    beforeEach(() => {
      mockAuthorizeWorkflow.mockResolvedValue({ allowed: true, workspacePermission: 'read' })
    })

    it('cannot persist a committed block position', async () => {
      // Unique socket id per test: the permission cache is module-global and keyed
      // by (user, workflow), so sharing a user across roles would hit a warm entry.
      const { socket, handlers } = setup('sock-read-1', 'read')

      await handlers['workflow-operation'](committedPositionUpdate())

      expect(mockPersist).not.toHaveBeenCalled()
      expect(socket.emit).toHaveBeenCalledWith(
        'operation-forbidden',
        expect.objectContaining({ type: 'INSUFFICIENT_PERMISSIONS' })
      )
    })

    it('cannot persist a batch position update', async () => {
      const { socket, handlers } = setup('sock-read-2', 'read')

      await handlers['workflow-operation'](batchPositionUpdate())

      expect(mockPersist).not.toHaveBeenCalled()
      expect(socket.emit).toHaveBeenCalledWith(
        'operation-forbidden',
        expect.objectContaining({ type: 'INSUFFICIENT_PERMISSIONS' })
      )
    })

    it('still relays an UNCOMMITTED position update without persisting it', async () => {
      // The smooth-drag broadcast is deliberately ungated (it never persists), and
      // tightening the ACL must not turn it into an error.
      const { socket, handlers, toEmit } = setup('sock-read-3', 'read')

      await handlers['workflow-operation']({
        ...committedPositionUpdate(),
        payload: { id: BLOCK_ID, position: { x: 5, y: 6 }, commit: false },
      })

      expect(mockPersist).not.toHaveBeenCalled()
      expect(toEmit).toHaveBeenCalledWith('workflow-operation', expect.anything())
      expect(socket.emit).not.toHaveBeenCalledWith(
        'operation-forbidden',
        expect.objectContaining({ type: 'INSUFFICIENT_PERMISSIONS' })
      )
    })
  })

  describe('write member (positive control)', () => {
    beforeEach(() => {
      mockAuthorizeWorkflow.mockResolvedValue({ allowed: true, workspacePermission: 'write' })
    })

    it('persists a committed block position', async () => {
      const { handlers } = setup('sock-write-1', 'write')

      await handlers['workflow-operation'](committedPositionUpdate())

      expect(mockPersist).toHaveBeenCalledWith(
        WORKFLOW_ID,
        expect.objectContaining({ operation: 'update-position' })
      )
    })

    it('persists a batch position update', async () => {
      const { handlers } = setup('sock-write-2', 'write')

      await handlers['workflow-operation'](batchPositionUpdate())

      expect(mockPersist).toHaveBeenCalledWith(
        WORKFLOW_ID,
        expect.objectContaining({ operation: 'batch-update-positions' })
      )
    })
  })
})
