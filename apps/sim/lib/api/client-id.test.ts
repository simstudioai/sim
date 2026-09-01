/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { CLIENT_ID_HEADER, fingerprintClientId, readClientId } from '@/lib/api/client-id'

describe('readClientId', () => {
  it('reads the sending tab id off the request', () => {
    const request = new Request('https://sim.ai/api/table/t1/rows', {
      headers: { [CLIENT_ID_HEADER]: 'tab-abc' },
    })
    expect(readClientId(request)).toBe('tab-abc')
  })

  /** Absent must read as "unattributed" — the signal then makes every client refetch, as before. */
  it('is undefined when the caller sent no id', () => {
    const request = new Request('https://sim.ai/api/table/t1/rows')
    expect(readClientId(request)).toBeUndefined()
  })

  /**
   * The value is caller-controlled and is broadcast to every subscriber of the table, so an
   * over-long one is dropped rather than fanned out.
   */
  it('drops an over-long id instead of broadcasting it', () => {
    const request = new Request('https://sim.ai/api/table/t1/rows', {
      headers: { [CLIENT_ID_HEADER]: 'x'.repeat(65) },
    })
    expect(readClientId(request)).toBeUndefined()
  })
})

/**
 * Every subscriber of a table sees every broadcast, so what gets published must not be replayable.
 * If the raw id travelled, a collaborator could read it off the stream, send it as their own
 * header, and have their write attributed to someone else's tab — which would then suppress a
 * refetch it genuinely needed and sit on stale rows.
 */
describe('fingerprintClientId', () => {
  it('is stable for the same id, so a tab recognises its own broadcast', async () => {
    expect(await fingerprintClientId('tab-abc')).toBe(await fingerprintClientId('tab-abc'))
  })

  it('differs between tabs, so one tab never suppresses on another tab’s write', async () => {
    expect(await fingerprintClientId('tab-abc')).not.toBe(await fingerprintClientId('tab-xyz'))
  })

  it('does not reveal the id it was derived from', async () => {
    const fingerprint = await fingerprintClientId('tab-abc')
    expect(fingerprint).not.toContain('tab-abc')
    // SHA-256 hex — knowing this cannot produce the header value that would match it.
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/)
  })
})
