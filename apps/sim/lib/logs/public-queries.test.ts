/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { decodePublicLogCursor, encodePublicLogCursor } from '@/lib/logs/public-queries'

describe('public log cursor', () => {
  const cursor = {
    startedAt: '2026-08-05T00:01:00.000Z',
    id: 'log-1',
    order: 'desc' as const,
  }

  it('round-trips under the order that minted it', () => {
    expect(decodePublicLogCursor(encodePublicLogCursor(cursor), 'desc')).toEqual(cursor)
  })

  it('rejects reuse under a different order', () => {
    expect(decodePublicLogCursor(encodePublicLogCursor(cursor), 'asc')).toBeNull()
  })

  it('accepts legacy cursors under the order requested by the caller', () => {
    const legacyCursor = Buffer.from(
      JSON.stringify({ startedAt: cursor.startedAt, id: cursor.id })
    ).toString('base64')

    expect(decodePublicLogCursor(legacyCursor, 'desc')).toEqual(cursor)
    expect(decodePublicLogCursor(legacyCursor, 'asc')).toEqual({ ...cursor, order: 'asc' })
  })
})
