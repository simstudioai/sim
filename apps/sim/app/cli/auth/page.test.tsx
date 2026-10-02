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
  `/cli/auth?request=${REQUEST}&challenge=${CHALLENGE}&pairing=${PAIRING}&scope=platform&workspace=workspace-fixture`
)

function pageProps() {
  return {
    searchParams: Promise.resolve({
      request: REQUEST,
      challenge: CHALLENGE,
      pairing: PAIRING,
      scope: 'platform',
      workspace: 'workspace-fixture',
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

  it('preserves the requested key scope and workspace through signup', async () => {
    await expect(CliAuthPage(pageProps())).rejects.toThrow(
      `NEXT_REDIRECT:/signup?callbackUrl=${EXPECTED_CALLBACK}`
    )
  })
})
