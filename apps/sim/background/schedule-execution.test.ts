/**
 * Covers the `active -> disabled` edge detection that drives the auto-disable
 * email. `applyScheduleFailureUpdate` is the exported seam over the shared
 * guarded UPDATE, so asserting on it also pins the behavior of the trigger.dev
 * call sites that go through the same helper.
 *
 * @vitest-environment node
 */
import { databaseMock, dbChainMockFns, resetDbChainMock, schemaMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { notifyMock } = vi.hoisted(() => ({
  notifyMock: vi.fn(() => Promise.resolve()),
}))

vi.mock('@/lib/workflows/schedules/disable-notifications', () => ({
  notifyScheduleAutoDisabled: notifyMock,
}))

// This module imports its tables from `@sim/db` directly, which the global mock
// does not re-export. Widen it rather than rewriting the source's imports.
vi.mock('@sim/db', () => ({ ...databaseMock, ...schemaMock }))

import {
  applyScheduleFailureUpdate,
  buildScheduleCancellationUpdate,
  classifyScheduleExecutionResult,
  readScheduledMothershipErrorResponse,
  readScheduledMothershipJsonResponse,
  releaseScheduleLock,
} from '@/background/schedule-execution'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const BASE = {
  scheduleId: 'schedule-1',
  now: new Date('2025-01-01T00:00:00.000Z'),
  nextRunAt: new Date('2025-01-01T01:00:00.000Z'),
  expectedLastQueuedAt: new Date('2024-12-31T23:00:00.000Z'),
  requestId: 'req-1',
  context: 'test context',
}

afterAll(() => {
  resetDbChainMock()
})

describe('applyScheduleFailureUpdate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('reports disabled when the write returns a disabled row', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'schedule-1', status: 'disabled' }])

    const result = await applyScheduleFailureUpdate(BASE)

    expect(result).toEqual({ updated: true, disabled: true })
  })

  it('reports not disabled below the threshold (the 99-of-100 case)', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'schedule-1', status: 'active' }])

    const result = await applyScheduleFailureUpdate(BASE)

    expect(result).toEqual({ updated: true, disabled: false })
  })

  it('reports neither updated nor disabled when the claim guard matches no row', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([])

    const result = await applyScheduleFailureUpdate(BASE)

    expect(result).toEqual({ updated: false, disabled: false })
  })

  it('defers the email so an in-transaction caller can send it after commit', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'schedule-1', status: 'disabled' }])

    await applyScheduleFailureUpdate(BASE)

    expect(notifyMock).not.toHaveBeenCalled()
  })

  it('excludes already-disabled rows so a disable is reported at most once', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'schedule-1', status: 'disabled' }])

    await applyScheduleFailureUpdate(BASE)

    const condition = dbChainMockFns.where.mock.calls.at(-1)?.[0]
    expect(JSON.stringify(condition)).toContain('disabled')
  })
})

describe('releaseScheduleLock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('never notifies, even when the row it releases is already disabled', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'schedule-1', status: 'disabled' }])

    const released = await releaseScheduleLock('schedule-1', 'req-1', new Date(), 'release')

    expect(released).toBe(true)
    expect(notifyMock).not.toHaveBeenCalled()
  })
})

describe('schedule cancellation accounting', () => {
  it('keeps a user cancellation distinct from a workflow failure', () => {
    expect(classifyScheduleExecutionResult({ success: false, status: 'cancelled' }, false)).toBe(
      'cancelled'
    )
  })

  it('continues to classify timeout cancellation as failure', () => {
    expect(classifyScheduleExecutionResult({ success: false, status: 'cancelled' }, true)).toBe(
      'failure'
    )
  })

  it('uses the persisted cancellation CAS as the authoritative terminal outcome', () => {
    expect(
      classifyScheduleExecutionResult({ success: true, status: 'completed' }, false, 'cancelled')
    ).toBe('cancelled')
    expect(
      classifyScheduleExecutionResult({ success: false, status: 'cancelled' }, true, 'cancelled')
    ).toBe('cancelled')
  })

  it('advances cadence and releases the claim without changing failure accounting', () => {
    const now = new Date('2026-08-03T12:00:00.000Z')
    const nextRunAt = new Date('2026-08-03T13:00:00.000Z')

    expect(buildScheduleCancellationUpdate(now, nextRunAt)).toEqual({
      lastRanAt: now,
      updatedAt: now,
      nextRunAt,
      lastQueuedAt: null,
      infraRetryCount: 0,
    })
    expect(buildScheduleCancellationUpdate(now, nextRunAt)).not.toHaveProperty('failedCount')
    expect(buildScheduleCancellationUpdate(now, nextRunAt)).not.toHaveProperty('lastFailedAt')
  })
})

describe('scheduled Mothership response handling', () => {
  it('parses JSON responses', async () => {
    const response = new Response(JSON.stringify({ content: 'ok' }), {
      headers: { 'content-type': 'application/json' },
    })

    await expect(readScheduledMothershipJsonResponse(response)).resolves.toEqual({ content: 'ok' })
  })

  it('preserves staging acceptance for responses above the generic tool cap', async () => {
    const response = new Response(JSON.stringify({ content: 'unchanged' }), {
      headers: {
        'content-length': String(10 * 1024 * 1024 + 1),
        'content-type': 'application/json',
      },
    })

    await expect(readScheduledMothershipJsonResponse(response)).resolves.toEqual({
      content: 'unchanged',
    })
  })

  it('does not include malformed response content in parse failures', async () => {
    const response = new Response('secret-bearing-non-json')
    const error = await readScheduledMothershipJsonResponse(response).catch((caught) => caught)

    expect(error).toBeInstanceOf(Error)
    expect(error.message).toBe('Sim execution returned an invalid response')
    expect(error.message).not.toContain('secret-bearing-non-json')
  })

  it('drops a legacy error body without poisoning later provenance', async () => {
    const registry = {
      markIncomplete: vi.fn(),
      importProvenance: vi.fn(),
    } as unknown as ResolvedSecretTraceRegistry
    const response = new Response('secret-bearing-error-body', { status: 500 })

    const message = await readScheduledMothershipErrorResponse(response, registry)

    expect(message).toBe('Internal Mothership response metadata could not be verified')
    expect(message).not.toContain('secret-bearing-error-body')
    expect(registry.markIncomplete).not.toHaveBeenCalled()
  })

  it('poisons provenance when a declared error response omits its private field', async () => {
    const registry = {
      markIncomplete: vi.fn(),
      importProvenance: vi.fn(),
    } as unknown as ResolvedSecretTraceRegistry
    const response = new Response(JSON.stringify({ error: 'unsafe detail' }), {
      status: 500,
      headers: { 'x-sim-private-tool-metadata': 'resolved-secret-provenance-v1' },
    })

    const message = await readScheduledMothershipErrorResponse(response, registry)

    expect(message).toBe('Internal Mothership response metadata could not be verified')
    expect(message).not.toContain('unsafe detail')
    expect(registry.markIncomplete).toHaveBeenCalledTimes(1)
  })

  it('strips private provenance metadata without replacing the provider error', async () => {
    const registry = {
      markIncomplete: vi.fn(),
      importProvenance: vi.fn().mockReturnValue(true),
    } as unknown as ResolvedSecretTraceRegistry
    const response = new Response(
      JSON.stringify({
        error: 'provider error detail',
        __resolvedSecretTraceProvenance: { version: 1, complete: true, entries: [] },
      }),
      {
        status: 500,
        headers: { 'x-sim-private-tool-metadata': 'resolved-secret-provenance-v1' },
      }
    )

    const message = await readScheduledMothershipErrorResponse(response, registry)

    expect(JSON.parse(message)).toEqual({ error: 'provider error detail' })
    expect(message).not.toContain('__resolvedSecretTraceProvenance')
    expect(registry.importProvenance).toHaveBeenCalledOnce()
  })
})
