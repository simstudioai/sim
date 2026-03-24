/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAsyncToolCalls } = vi.hoisted(() => ({
  getAsyncToolCalls: vi.fn(),
}))

const channelHandlers = new Set<(event: any) => void>()

vi.mock('@/lib/copilot/async-runs/repository', () => ({
  getAsyncToolCalls,
}))

vi.mock('@/lib/events/pubsub', () => ({
  createPubSubChannel: () => ({
    publish(event: any) {
      for (const handler of channelHandlers) handler(event)
    },
    subscribe(handler: (event: any) => void) {
      channelHandlers.add(handler)
      return () => {
        channelHandlers.delete(handler)
      }
    },
    dispose() {},
  }),
}))

import {
  getToolConfirmation,
  publishToolConfirmation,
  waitForToolConfirmation,
} from './persistence'

describe('copilot orchestrator persistence', () => {
  let row: {
    status: string
    error?: string | null
    result?: Record<string, unknown> | null
    updatedAt: Date
  } | null

  beforeEach(() => {
    vi.clearAllMocks()
    channelHandlers.clear()
    row = null
    getAsyncToolCalls.mockImplementation(async () => (row ? [row] : []))
  })

  it('reads the durable DB row as the source of truth', async () => {
    row = {
      status: 'completed',
      result: { ok: true },
      error: null,
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    }

    await expect(getToolConfirmation('tool-1')).resolves.toEqual({
      status: 'success',
      message: undefined,
      data: { ok: true },
      timestamp: '2026-01-01T00:00:00.000Z',
    })
  })

  it('waits through intermediate events until the durable row becomes terminal', async () => {
    row = {
      status: 'pending',
      error: null,
      result: null,
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    }

    const waitPromise = waitForToolConfirmation('tool-1', 5_000, undefined, {
      acceptStatus: (status) =>
        status === 'success' || status === 'error' || status === 'cancelled',
    })

    publishToolConfirmation({
      toolCallId: 'tool-1',
      status: 'accepted',
      timestamp: '2026-01-01T00:00:01.000Z',
    })

    await Promise.resolve()

    row = {
      status: 'completed',
      error: null,
      result: { ok: true },
      updatedAt: new Date('2026-01-01T00:00:02.000Z'),
    }

    publishToolConfirmation({
      toolCallId: 'tool-1',
      status: 'success',
      timestamp: '2026-01-01T00:00:02.000Z',
    })

    await expect(waitPromise).resolves.toEqual({
      status: 'success',
      message: undefined,
      data: { ok: true },
      timestamp: '2026-01-01T00:00:02.000Z',
    })
  })
})
