import { describe, expect, it } from 'vitest'
import { getRequestContext, runWithRequestContext, setRequestAuth } from './request-context'

describe('setRequestAuth', () => {
  it('keeps an auth already recorded when asked to preserve it', () => {
    runWithRequestContext({ requestId: 'req-1' }, () => {
      setRequestAuth({ kind: 'delegated', service: 'executor' })
      setRequestAuth({ kind: 'session' }, { preserveExisting: true })

      expect(getRequestContext()?.auth).toEqual({ kind: 'delegated', service: 'executor' })
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
})
