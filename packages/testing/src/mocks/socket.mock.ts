import { type Mock, vi } from 'vitest'

/**
 * Mock socket interface for type safety.
 */
export interface IMockSocket {
  id: string
  connected: boolean
  disconnected: boolean
  emit: Mock
  on: Mock
  once: Mock
  off: Mock
  connect: Mock
  disconnect: Mock
  join: Mock
  leave: Mock
  _handlers: Record<string, ((...args: any[]) => any)[]>
  _trigger: (event: string, ...args: any[]) => void
  _reset: () => void
}

/**
 * Creates a mock Socket.IO client socket.
 *
 * @example
 * ```ts
 * const socket = createMockSocket()
 * socket.emit('test', { data: 'value' })
 * expect(socket.emit).toHaveBeenCalledWith('test', { data: 'value' })
 * ```
 */
export function createMockSocket(): IMockSocket {
  const eventHandlers: Record<string, ((...args: any[]) => any)[]> = {}

  const socket = {
    id: `socket-${Math.random().toString(36).substring(2, 10)}`,
    connected: true,
    disconnected: false,

    // Core methods
    emit: vi.fn((event: string, ..._args: any[]) => {
      return socket
    }),

    on: vi.fn((event: string, handler: (...args: any[]) => any) => {
      if (!eventHandlers[event]) {
        eventHandlers[event] = []
      }
      eventHandlers[event].push(handler)
      return socket
    }),

    once: vi.fn((event: string, handler: (...args: any[]) => any) => {
      if (!eventHandlers[event]) {
        eventHandlers[event] = []
      }
      eventHandlers[event].push(handler)
      return socket
    }),

    off: vi.fn((event: string, handler?: (...args: any[]) => any) => {
      if (handler && eventHandlers[event]) {
        eventHandlers[event] = eventHandlers[event].filter((h) => h !== handler)
      } else {
        delete eventHandlers[event]
      }
      return socket
    }),

    connect: vi.fn(() => {
      socket.connected = true
      socket.disconnected = false
      return socket
    }),

    disconnect: vi.fn(() => {
      socket.connected = false
      socket.disconnected = true
      return socket
    }),

    // Room methods
    join: vi.fn((_room: string) => socket),
    leave: vi.fn((_room: string) => socket),

    // Utility methods for testing
    _handlers: eventHandlers,

    _trigger: (event: string, ...args: any[]) => {
      const handlers = eventHandlers[event] || []
      handlers.forEach((handler) => handler(...args))
    },

    _reset: () => {
      Object.keys(eventHandlers).forEach((key) => delete eventHandlers[key])
      socket.emit.mockClear()
      socket.on.mockClear()
      socket.once.mockClear()
      socket.off.mockClear()
    },
  }

  return socket
}

/**
 * Mock socket server interface.
 */
export interface IMockSocketServer {
  sockets: Map<string, IMockSocket>
  rooms: Map<string, Set<string>>
  emit: Mock
  to: Mock
  in: Mock
  _addSocket: (socket: IMockSocket) => void
  _joinRoom: (socketId: string, room: string) => void
  _leaveRoom: (socketId: string, room: string) => void
}

/**
 * Creates a mock Socket.IO server.
 */
export function createMockSocketServer(): IMockSocketServer {
  const sockets = new Map<string, IMockSocket>()
  const rooms = new Map<string, Set<string>>()

  return {
    sockets,
    rooms,

    emit: vi.fn((_event: string, ..._args: any[]) => {}),

    to: vi.fn((room: string) => ({
      emit: vi.fn((event: string, ...args: any[]) => {
        const socketIds = rooms.get(room) || new Set()
        socketIds.forEach((id) => {
          const socket = sockets.get(id)
          if (socket) {
            socket._trigger(event, ...args)
          }
        })
      }),
    })),

    in: vi.fn((room: string) => ({
      emit: vi.fn((event: string, ...args: any[]) => {
        const socketIds = rooms.get(room) || new Set()
        socketIds.forEach((id) => {
          const socket = sockets.get(id)
          if (socket) {
            socket._trigger(event, ...args)
          }
        })
      }),
    })),

    _addSocket: (socket: ReturnType<typeof createMockSocket>) => {
      sockets.set(socket.id, socket)
    },

    _joinRoom: (socketId: string, room: string) => {
      if (!rooms.has(room)) {
        rooms.set(room, new Set())
      }
      rooms.get(room)?.add(socketId)
    },

    _leaveRoom: (socketId: string, room: string) => {
      rooms.get(room)?.delete(socketId)
    },
  }
}

/**
 * Type aliases for convenience.
 */
export type MockSocket = IMockSocket
export type MockSocketServer = IMockSocketServer
