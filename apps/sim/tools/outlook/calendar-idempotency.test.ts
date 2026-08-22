/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockWarn } = vi.hoisted(() => ({ mockWarn: vi.fn() }))

vi.mock('@sim/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: mockWarn,
    error: vi.fn(),
    debug: vi.fn(),
  }),
  logger: { info: vi.fn(), warn: mockWarn, error: vi.fn(), debug: vi.fn() },
  runWithRequestContext: <T>(_context: unknown, fn: () => T): T => fn(),
  getRequestContext: () => undefined,
  setRequestTraceId: vi.fn(),
}))

import { deriveDeliveryKey } from '@/lib/core/http/derive-key'
import { outlookCalendarCreateEventTool } from '@/tools/outlook/calendar_create_event'
import type { ToolConfig } from '@/tools/types'

/** A complete execution identity, as the executor is expected to inject it. */
const CONTEXT = {
  executionId: 'exec-1',
  blockId: 'block-1',
  invocationId: '7',
} as const

/** Graph's documented ceiling on `event.transactionId`. */
const GRAPH_TRANSACTION_ID_MAX_LENGTH = 256

const tool = outlookCalendarCreateEventTool

/**
 * Calls a tool's body builder the way tool preparation does.
 *
 * Reading `request.body` is confined to the canonical transport in production
 * source; `check-tool-request-boundary.ts` exempts test files precisely so a
 * request shape can be asserted without a live transport.
 */
function buildBody(config: ToolConfig, params: Record<string, unknown>): Record<string, unknown> {
  const body = config.request.body?.(params)
  if (typeof body !== 'object' || body === null || body instanceof FormData) {
    throw new Error(`${config.id}: expected a plain object body`)
  }
  return body as Record<string, unknown>
}

const eventParams = () => ({
  accessToken: 't',
  subject: 'Standup',
  startDateTime: '2026-06-03T10:00:00',
  endDateTime: '2026-06-03T10:30:00',
})

describe('outlook_calendar_create_event transactionId', () => {
  beforeEach(() => {
    mockWarn.mockClear()
  })

  it('derives the transactionId from the execution identity, keyed to its own tool id', () => {
    const body = buildBody(tool, { ...eventParams(), _context: { ...CONTEXT } })

    expect(body.transactionId).toBe(deriveDeliveryKey({ ...CONTEXT, toolId: tool.id }, tool.id))
  })

  it('produces the same transactionId when tool preparation is re-entered', () => {
    const first = buildBody(tool, { ...eventParams(), _context: { ...CONTEXT } })
    const second = buildBody(tool, { ...eventParams(), _context: { ...CONTEXT } })

    expect(second.transactionId).toBe(first.transactionId)
  })

  it('produces a different transactionId for a different invocation of the same block', () => {
    const first = buildBody(tool, { ...eventParams(), _context: { ...CONTEXT } })
    const second = buildBody(tool, {
      ...eventParams(),
      _context: { ...CONTEXT, invocationId: '8' },
    })

    expect(second.transactionId).not.toBe(first.transactionId)
  })

  it('fits inside Graph’s transactionId ceiling', () => {
    const body = buildBody(tool, { ...eventParams(), _context: { ...CONTEXT } })

    expect(String(body.transactionId).length).toBeLessThanOrEqual(GRAPH_TRANSACTION_ID_MAX_LENGTH)
  })

  it('leaves the rest of the event body intact', () => {
    const body = buildBody(tool, {
      ...eventParams(),
      location: 'Room 1',
      _context: { ...CONTEXT },
    })

    expect(body.subject).toBe('Standup')
    expect(body.location).toEqual({ displayName: 'Room 1' })
    expect(body.start).toEqual({ dateTime: '2026-06-03T10:00:00', timeZone: 'UTC' })
  })

  it('falls back to a fresh transactionId and warns when the execution identity is incomplete', () => {
    const incomplete = { executionId: 'exec-1' }
    const first = buildBody(tool, { ...eventParams(), _context: { ...incomplete } })
    const second = buildBody(tool, { ...eventParams(), _context: { ...incomplete } })

    expect(first.transactionId).toEqual(expect.any(String))
    expect(second.transactionId).not.toBe(first.transactionId)
    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining('could not be derived'),
      expect.objectContaining({
        toolId: tool.id,
        missingContextFields: ['blockId', 'invocationId'],
      })
    )
  })
})
