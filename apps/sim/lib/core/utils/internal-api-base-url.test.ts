/**
 * `INTERNAL_API_BASE_URL` names a route that only resolves from inside the app
 * container — a loopback address, or a cluster-internal Service name. A
 * Trigger.dev worker runs in Trigger's infrastructure, so honouring it there
 * points the request at the worker's own loopback where nothing is listening.
 *
 * Several modules run in BOTH runtimes and call this. `lib/guardrails/mask-client.ts`
 * is the sharp one — its own TSDoc notes the log-redaction persist path runs
 * inside the trigger.dev runtime — so setting the variable produced
 * `PII redaction failed: Unable to connect` on every worker-side redaction.
 *
 * @vitest-environment node
 */
import { resetEnvMock, setEnv } from '@sim/testing'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * `vitest.setup.ts` mocks this module globally with a hand-written mirror, so
 * without this the suite would assert against that mirror rather than the
 * function it names — and any drift between the two would pass unnoticed.
 */
vi.unmock('@/lib/core/utils/urls')

import { getInternalApiBaseUrl } from '@/lib/core/utils/urls'

const PUBLIC_URL = 'https://sim.ai'
const LOOPBACK = 'http://127.0.0.1:3000'

afterEach(() => {
  resetEnvMock()
})

describe('getInternalApiBaseUrl', () => {
  it('uses the internal URL in the app container', () => {
    setEnv({
      INTERNAL_API_BASE_URL: LOOPBACK,
      NEXT_PUBLIC_APP_URL: PUBLIC_URL,
      DB_APP_NAME: 'sim',
    })

    expect(getInternalApiBaseUrl()).toBe(LOOPBACK)
  })

  /** Callers concatenate `${base}/api/...`, exactly as they do with getBaseUrl(). */
  it('strips a trailing slash from the internal URL', () => {
    setEnv({
      INTERNAL_API_BASE_URL: `${LOOPBACK}/`,
      NEXT_PUBLIC_APP_URL: PUBLIC_URL,
      DB_APP_NAME: 'sim',
    })

    expect(getInternalApiBaseUrl()).toBe(LOOPBACK)
  })

  it('IGNORES the internal URL on a Trigger.dev worker and falls back to the public URL', () => {
    setEnv({
      INTERNAL_API_BASE_URL: LOOPBACK,
      NEXT_PUBLIC_APP_URL: PUBLIC_URL,
      DB_APP_NAME: 'sim-trigger',
    })

    expect(getInternalApiBaseUrl()).toBe(PUBLIC_URL)
  })

  it('falls back to the public URL when the internal URL is unset', () => {
    setEnv({
      INTERNAL_API_BASE_URL: undefined,
      NEXT_PUBLIC_APP_URL: PUBLIC_URL,
      DB_APP_NAME: 'sim',
    })

    expect(getInternalApiBaseUrl()).toBe(PUBLIC_URL)
  })

  it('still rejects a value with no protocol, so a typo fails loudly', () => {
    setEnv({
      INTERNAL_API_BASE_URL: '127.0.0.1:3000',
      NEXT_PUBLIC_APP_URL: PUBLIC_URL,
      DB_APP_NAME: 'sim',
    })

    expect(() => getInternalApiBaseUrl()).toThrow(/must include protocol/i)
  })
})
