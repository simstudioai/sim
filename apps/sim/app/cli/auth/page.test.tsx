/**
 * @vitest-environment node
 */
import { envFlagsMock } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockRedirect } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockRedirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
  getSession: mockGetSession,
}))

vi.mock('next/navigation', () => ({
  redirect: mockRedirect,
}))

import CliAuthPage from '@/app/cli/auth/page'

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
    vi.clearAllMocks()
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

  /**
   * Nobody can create an account under the flag, so the pairing visitor is
   * necessarily an existing user and signup would be a guaranteed dead end.
   */
  it('sends them to login instead when registration is disabled', async () => {
    envFlagsMock.isRegistrationDisabled = true

    await expect(CliAuthPage(pageProps())).rejects.toThrow(
      `NEXT_REDIRECT:/login?callbackUrl=${EXPECTED_CALLBACK}`
    )
  })
})
