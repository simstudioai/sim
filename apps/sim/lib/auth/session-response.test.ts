/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { extractSessionDataFromAuthClientResult } from '@/lib/auth/session-response'

describe('extractSessionDataFromAuthClientResult', () => {
  it('returns null for non-objects', () => {
    expect(extractSessionDataFromAuthClientResult(null)).toBeNull()
    expect(extractSessionDataFromAuthClientResult(undefined)).toBeNull()
    expect(extractSessionDataFromAuthClientResult('nope')).toBeNull()
    expect(extractSessionDataFromAuthClientResult(123)).toBeNull()
  })

  it('prefers .data when present', () => {
    expect(extractSessionDataFromAuthClientResult({ data: null, error: null })).toBeNull()

    const session = { user: { id: 'u1' }, session: { id: 's1' } }
    expect(extractSessionDataFromAuthClientResult({ data: session, error: null })).toEqual(session)
  })

  it('rejects the resolved error envelope returned by Better Auth', () => {
    expect(() =>
      extractSessionDataFromAuthClientResult({
        data: null,
        error: {
          message: 'Session expired',
          status: 401,
          statusText: 'Unauthorized',
        },
      })
    ).toThrow('Session expired')
  })

  it('does not classify arbitrary error-shaped data as a Better Auth error envelope', () => {
    const domainPayload = {
      data: { error: { message: 'Domain data' } },
      error: null,
    }

    expect(extractSessionDataFromAuthClientResult(domainPayload)).toEqual(domainPayload.data)
  })

  it('falls back to raw session payload shape', () => {
    const raw = { user: { id: 'u1' }, session: { id: 's1' } }
    expect(extractSessionDataFromAuthClientResult(raw)).toEqual(raw)
  })

  it('returns null for unknown object shapes', () => {
    expect(extractSessionDataFromAuthClientResult({})).toBeNull()
    expect(extractSessionDataFromAuthClientResult({ ok: true })).toBeNull()
  })
})
