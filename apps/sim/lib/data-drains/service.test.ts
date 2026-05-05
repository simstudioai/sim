/**
 * @vitest-environment node
 */
import { dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db', () => dbChainMock)

const { mockGetSource, mockGetDestination, mockDecryptCredentials } = vi.hoisted(() => ({
  mockGetSource: vi.fn(),
  mockGetDestination: vi.fn(),
  mockDecryptCredentials: vi.fn(),
}))

vi.mock('@/lib/data-drains/sources/registry', () => ({ getSource: mockGetSource }))
vi.mock('@/lib/data-drains/destinations/registry', () => ({ getDestination: mockGetDestination }))
vi.mock('@/lib/data-drains/encryption', () => ({ decryptCredentials: mockDecryptCredentials }))

import { runDrain } from '@/lib/data-drains/service'

type Row = { id: string; ts: string }

function makeSource(pages: Row[][]) {
  return {
    type: 'workflow_logs' as const,
    displayName: 'Test',
    pages: vi.fn(async function* () {
      for (const page of pages) yield page
    }),
    serialize: vi.fn((row: Row) => row),
    cursorAfter: vi.fn((row: Row) => JSON.stringify({ ts: row.ts, id: row.id })),
  }
}

function makeDestination(
  opts: { deliver?: ReturnType<typeof vi.fn>; close?: ReturnType<typeof vi.fn> } = {}
) {
  const deliver =
    opts.deliver ??
    vi.fn(async ({ metadata }: { metadata: { sequence: number } }) => ({
      locator: `loc-${metadata.sequence}`,
    }))
  const close = opts.close ?? vi.fn(async () => {})
  return {
    type: 's3' as const,
    displayName: 'Test',
    configSchema: { parse: (v: unknown) => v },
    credentialsSchema: { parse: (v: unknown) => v },
    openSession: vi.fn(() => ({ deliver, close })),
    _deliver: deliver,
    _close: close,
  }
}

const baseDrain = {
  id: 'drain-1',
  organizationId: 'org-1',
  enabled: true,
  source: 'workflow_logs',
  destinationType: 's3',
  destinationConfig: {},
  destinationCredentials: 'enc:blob',
  cursor: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
  mockDecryptCredentials.mockResolvedValue({})
})

describe('runDrain', () => {
  it('returns skipped when drain is disabled', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ ...baseDrain, enabled: false }])
    const result = await runDrain('drain-1', 'manual')
    expect(result.status).toBe('skipped')
    expect(result.rowsExported).toBe(0)
    expect(mockGetSource).not.toHaveBeenCalled()
  })

  it('throws when drain does not exist', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([])
    await expect(runDrain('drain-1', 'manual')).rejects.toThrow(/not found/)
  })

  it('delivers each page and advances cursor on success', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([baseDrain])
    const source = makeSource([
      [
        { id: 'r1', ts: '2026-01-01T00:00:00.000Z' },
        { id: 'r2', ts: '2026-01-01T00:00:01.000Z' },
      ],
      [{ id: 'r3', ts: '2026-01-01T00:00:02.000Z' }],
    ])
    const destination = makeDestination()
    mockGetSource.mockReturnValue(source)
    mockGetDestination.mockReturnValue(destination)

    const result = await runDrain('drain-1', 'cron')

    expect(result.status).toBe('success')
    expect(result.rowsExported).toBe(3)
    expect(destination._deliver).toHaveBeenCalledTimes(2)
    expect(destination._close).toHaveBeenCalledTimes(1)
    expect(result.cursorAfter).toBe(JSON.stringify({ ts: '2026-01-01T00:00:02.000Z', id: 'r3' }))
    expect(result.locators).toEqual(['loc-0', 'loc-1'])

    // Drain row updated with new cursor; transaction was used.
    expect(dbChainMockFns.transaction).toHaveBeenCalled()
    const drainUpdate = dbChainMockFns.set.mock.calls.find(
      (call) => (call[0] as { cursor?: unknown }).cursor !== undefined
    )
    expect(drainUpdate?.[0]).toMatchObject({ cursor: result.cursorAfter })
  })

  it('does not advance drain cursor when delivery fails', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ ...baseDrain, cursor: 'prior' }])
    const source = makeSource([[{ id: 'r1', ts: '2026-01-01T00:00:00.000Z' }]])
    const destination = makeDestination({
      deliver: vi.fn(async () => {
        throw new Error('boom')
      }),
    })
    mockGetSource.mockReturnValue(source)
    mockGetDestination.mockReturnValue(destination)

    await expect(runDrain('drain-1', 'cron')).rejects.toThrow('boom')

    // Run row updated with status=failed and cursorAfter equal to prior cursor.
    const failedUpdate = dbChainMockFns.set.mock.calls.find(
      (call) => (call[0] as { status?: unknown }).status === 'failed'
    )
    expect(failedUpdate?.[0]).toMatchObject({ status: 'failed', cursorAfter: 'prior' })

    // No drain-row update with a new cursor field.
    const cursorAdvanced = dbChainMockFns.set.mock.calls.some(
      (call) => 'cursor' in (call[0] as object)
    )
    expect(cursorAdvanced).toBe(false)

    expect(destination._close).toHaveBeenCalledTimes(1)
  })

  it('closes session even if close throws', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([baseDrain])
    const source = makeSource([])
    const destination = makeDestination({
      close: vi.fn(async () => {
        throw new Error('close-failed')
      }),
    })
    mockGetSource.mockReturnValue(source)
    mockGetDestination.mockReturnValue(destination)

    const result = await runDrain('drain-1', 'manual')
    expect(result.status).toBe('success')
    expect(destination._close).toHaveBeenCalled()
  })
})
