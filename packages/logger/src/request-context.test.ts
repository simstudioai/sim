import { describe, expect, it } from 'vitest'
import { getRequestContext, runWithRequestContext, setRequestAuth } from './request-context'

describe('setRequestAuth', () => {
  it('replaces the recorded auth by default', () => {
    runWithRequestContext({ requestId: 'req-1' }, () => {
      setRequestAuth({ kind: 'internal_jwt' })
      setRequestAuth({ kind: 'delegated', service: 'executor' })

      expect(getRequestContext()?.auth).toEqual({ kind: 'delegated', service: 'executor' })
    })
  })

  it('keeps an auth already recorded when asked to preserve it', () => {
    runWithRequestContext({ requestId: 'req-1' }, () => {
      setRequestAuth({ kind: 'delegated', service: 'executor' })
      setRequestAuth({ kind: 'session' }, { preserveExisting: true })

      expect(getRequestContext()?.auth).toEqual({ kind: 'delegated', service: 'executor' })
    })
  })

  it('fills an empty slot even when asked to preserve', () => {
    runWithRequestContext({ requestId: 'req-1' }, () => {
      setRequestAuth({ kind: 'session' }, { preserveExisting: true })

      expect(getRequestContext()?.auth).toEqual({ kind: 'session' })
    })
  })

  it('attributes a client that did not identify itself by the credential', () => {
    runWithRequestContext(
      { requestId: 'req-1', client: { surface: 'unknown', source: 'unidentified', name: 'curl' } },
      () => {
        setRequestAuth({ kind: 'personal_api_key' }, { preserveExisting: true })

        expect(getRequestContext()?.client).toEqual({
          surface: 'api',
          source: 'credential',
          name: 'curl',
        })
      }
    )
  })

  it('leaves a client that identified itself as it declared', () => {
    runWithRequestContext(
      { requestId: 'req-1', client: { surface: 'cli', version: '2.1.2', source: 'header' } },
      () => {
        setRequestAuth({ kind: 'oauth_access_token', clientId: 'sim-cli' })

        expect(getRequestContext()?.client?.surface).toBe('cli')
      }
    )
  })

  it('does nothing outside a request', () => {
    expect(() => setRequestAuth({ kind: 'session' })).not.toThrow()
    expect(getRequestContext()).toBeUndefined()
  })
})
