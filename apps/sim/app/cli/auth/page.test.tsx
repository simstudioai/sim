import { envFlagsMock } from '@sim/testing'
import { authMockFns } from '@sim/testing/mocks/auth.mock'
import { nextNavigationMock } from '@sim/testing/mocks/next-navigation.mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => nextNavigationMock)

import CliAuthPage from '@/app/cli/auth/page'

const mockGetSession = authMockFns.mockGetSession

/** BASE64URL, 43 chars; pairing is `XXXX-XXXX` over the no-look-alike alphabet. */
const REQUEST = 'r'.repeat(43)
const CHALLENGE = 'c'.repeat(43)
const PAIRING = 'ABCD-2345'

const EXPECTED_CALLBACK = encodeURIComponent(
  `/cli/auth?request=${REQUEST}&challenge=${CHALLENGE}&pairing=${PAIRING}`
)

function pageProps() {
  return {
    searchParams: Promise.resolve({
      request: REQUEST,
      challenge: CHALLENGE,
      pairing: PAIRING,
    }),
  }
}

describe('CliAuthPage signed-out bounce', () => {
  beforeEach(() => {
    mockGetSession.mockResolvedValue(null)
  })

  afterEach(() => {
    envFlagsMock.isRegistrationDisabled = false
  })

  it('sends a signed-out visitor to signup, carrying the handoff as callbackUrl', async () => {
    await expect(CliAuthPage(pageProps())).rejects.toThrow(
      `NEXT_REDIRECT:/signup?callbackUrl=${EXPECTED_CALLBACK}`
    )
  })

  it('keeps a requested read-only, expiring platform key through the bounce', async () => {
    const error = await CliAuthPage({
      searchParams: Promise.resolve({
        request: REQUEST,
        challenge: CHALLENGE,
        pairing: PAIRING,
        scope: 'platform',
        access: 'read',
        expires: '30',
      }),
    }).catch((e: unknown) => e)

    const location = new URL(
      String((error as Error).message).replace('NEXT_REDIRECT:', ''),
      'https://sim.test'
    )
    const callback = new URL(location.searchParams.get('callbackUrl') ?? '', 'https://sim.test')
    expect(callback.searchParams.get('scope')).toBe('platform')
    expect(callback.searchParams.get('access')).toBe('read')
    expect(callback.searchParams.get('expires')).toBe('30')
  })
})
