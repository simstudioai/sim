/**
 * @vitest-environment jsdom
 */

import { act, renderHook, waitFor } from '@testing-library/react'
import { io } from 'socket.io-client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SocketProvider, useSocket } from './socket-context'

vi.mock('socket.io-client')
const mockIo = vi.mocked(io)

global.fetch = vi.fn()
const mockFetch = vi.mocked(fetch)

vi.mock('@/lib/logs/console-logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}))

describe('SocketContext Token Refresh', () => {
  let mockSocket: any
  let eventHandlers: Record<string, any>

  beforeEach(() => {
    eventHandlers = {}
    mockSocket = {
      id: 'test-socket-id',
      connected: true,
      io: { engine: { transport: { name: 'websocket' } } },
      auth: { token: 'initial-token' },
      on: vi.fn((event, handler) => {
        eventHandlers[event] = handler
      }),
      connect: vi.fn(),
      disconnect: vi.fn(),
      emit: vi.fn(),
      close: vi.fn(),
    }

    mockIo.mockReturnValue(mockSocket)

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'fresh-token' }),
    } as Response)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  const renderSocketProvider = async (user = { id: 'test-user', name: 'Test User' }) => {
    const result = renderHook(() => useSocket(), {
      wrapper: ({ children }) => <SocketProvider user={user}>{children}</SocketProvider>,
    })

    await waitFor(() => {
      expect(mockSocket.on).toHaveBeenCalledWith('connect_error', expect.any(Function))
    })

    vi.clearAllMocks()

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'fresh-token' }),
    } as Response)

    return result
  }

  describe('Token Refresh on Connection Error', () => {
    it('should refresh token on authentication failure', async () => {
      const { result } = await renderSocketProvider()

      const error = { message: 'Token validation failed' }

      await act(async () => {
        await eventHandlers.connect_error(error)
      })

      expect(mockFetch).toHaveBeenCalledWith('/api/auth/socket-token', {
        method: 'POST',
        credentials: 'include',
      })

      // Should update socket auth and reconnect
      expect(mockSocket.auth.token).toBe('fresh-token')
      expect(mockSocket.connect).toHaveBeenCalled()
    })

    it('should limit token refresh attempts to 3', async () => {
      const { result } = await renderSocketProvider()

      const error = { message: 'Token validation failed' }

      for (let i = 0; i < 4; i++) {
        await act(async () => {
          await eventHandlers.connect_error(error)
        })
      }

      // Should only call fetch 3 times (max attempts)
      expect(mockFetch).toHaveBeenCalledTimes(3)
      expect(mockSocket.connect).toHaveBeenCalledTimes(3)
    })

    it('should prevent concurrent token refresh attempts', async () => {
      const { result } = await renderSocketProvider()

      let resolveTokenFetch!: (value: {
        ok: boolean
        json: () => Promise<{ token: string }>
      }) => void
      const slowTokenPromise = new Promise((resolve) => {
        resolveTokenFetch = resolve
      })

      mockFetch.mockReturnValue(slowTokenPromise as any)

      const error = { message: 'Authentication failed' }

      // Start two concurrent refresh attempts
      const promise1 = act(async () => {
        await eventHandlers.connect_error(error)
      })

      const promise2 = act(async () => {
        await eventHandlers.connect_error(error)
      })

      // Resolve the slow fetch
      resolveTokenFetch({
        ok: true,
        json: async () => ({ token: 'fresh-token' }),
      })

      await Promise.all([promise1, promise2])

      // Should only call fetch once (concurrent protection)
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('should reset retry counter on successful connection', async () => {
      const { result } = await renderSocketProvider()

      const error = { message: 'Token validation failed' }

      // Use up 2 retry attempts
      await act(async () => {
        await eventHandlers.connect_error(error)
      })
      await act(async () => {
        await eventHandlers.connect_error(error)
      })

      expect(mockFetch).toHaveBeenCalledTimes(2)

      // Simulate successful connection (resets counter)
      await act(async () => {
        eventHandlers.connect()
      })

      // Should be able to retry again (counter reset)
      await act(async () => {
        await eventHandlers.connect_error(error)
      })

      expect(mockFetch).toHaveBeenCalledTimes(3)
    })

    it('should handle token refresh failure gracefully', async () => {
      const { result } = await renderSocketProvider()

      // Mock failed token refresh after initialization
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
      } as Response)

      const error = { message: 'Token validation failed' }

      await act(async () => {
        await eventHandlers.connect_error(error)
      })

      // Should attempt refresh but not update auth or reconnect
      expect(mockFetch).toHaveBeenCalled()
      expect(mockSocket.auth.token).toBe('initial-token') // unchanged
      expect(mockSocket.connect).not.toHaveBeenCalled()
    })

    it('should handle fetch errors gracefully', async () => {
      const { result } = await renderSocketProvider()

      // Mock fetch error after initialization
      mockFetch.mockRejectedValue(new Error('Network error'))

      const error = { message: 'Authentication failed' }

      // Should not throw error
      await act(async () => {
        await eventHandlers.connect_error(error)
      })

      expect(mockFetch).toHaveBeenCalled()
      expect(mockSocket.connect).not.toHaveBeenCalled()
    })

    it('should only refresh token on authentication-related errors', async () => {
      const { result } = await renderSocketProvider()

      // Non-authentication error
      const networkError = { message: 'Network timeout' }

      await act(async () => {
        await eventHandlers.connect_error(networkError)
      })

      // Should not attempt token refresh
      expect(mockFetch).not.toHaveBeenCalled()
      expect(mockSocket.connect).not.toHaveBeenCalled()
    })
  })

  describe('Interaction with Socket.IO Reconnection', () => {
    it('should work with Socket.IO built-in reconnection attempts', async () => {
      const { result } = await renderSocketProvider()

      // Simulate Socket.IO reconnection cycle
      await act(async () => {
        // Reconnection attempt starts
        eventHandlers.reconnect_attempt(1)
      })

      await act(async () => {
        // Fails with auth error
        await eventHandlers.connect_error({ message: 'Token validation failed' })
      })

      // Should refresh token and attempt reconnection
      expect(mockFetch).toHaveBeenCalled()
      expect(mockSocket.connect).toHaveBeenCalled()
    })

    it('should reset counters on successful reconnect', async () => {
      const { result } = await renderSocketProvider()

      // Use up retry attempts
      const error = { message: 'Authentication failed' }
      await act(async () => {
        await eventHandlers.connect_error(error)
      })

      await act(async () => {
        await eventHandlers.connect_error(error)
      })

      expect(mockFetch).toHaveBeenCalledTimes(2)

      // Simulate successful reconnection
      await act(async () => {
        eventHandlers.reconnect(1)
      })

      // Should reset and allow new attempts
      await act(async () => {
        await eventHandlers.connect_error(error)
      })

      expect(mockFetch).toHaveBeenCalledTimes(3)
    })
  })
})
