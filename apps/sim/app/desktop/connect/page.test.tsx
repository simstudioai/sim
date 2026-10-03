import { authMockFns } from '@sim/testing/mocks/auth.mock'
import { authClientMock } from '@sim/testing/mocks/auth-client.mock'
import { nextNavigationMock } from '@sim/testing/mocks/next-navigation.mock'
import { urlsMockFns } from '@sim/testing/mocks/urls.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/auth-client', () => authClientMock)

/** Keeps the landing-page barrel the real shell pulls in out of this graph. */
vi.mock('@/app/desktop/components/desktop-handoff-shell', () => ({
  DesktopHandoffShell: () => null,
}))

vi.mock('next/navigation', () => nextNavigationMock)

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers()),
}))

import DesktopConnectPage from '@/app/desktop/connect/page'

const mockGetSession = authMockFns.mockGetSession

const VALID_STATE = 'a'.repeat(32)
const PORT = '57979'

function pageProps(params: Record<string, string>) {
  return { searchParams: Promise.resolve(params) }
}

async function renderPage(params: Record<string, string>) {
  const result = (await DesktopConnectPage(pageProps(params))) as unknown as {
    type: { name: string }
    props: Record<string, unknown>
  }
  return result
}

describe('DesktopConnectPage', () => {
  beforeEach(() => {
    urlsMockFns.mockGetBaseUrl.mockReturnValue('https://sim.test')
    mockGetSession.mockResolvedValue({
      user: { id: 'user-1', email: 'user@example.com' },
    })
  })

  it('hands the launcher an absolute complete URL so the callback can read the draft back', async () => {
    // Better Auth stores `callbackURL` verbatim, and the OAuth callback parses it
    // with `new URL`. A bare path threw there, failing the whole callback with a
    // 500 after the provider had already authorized.
    const result = await renderPage({
      provider: 'google-email',
      state: VALID_STATE,
      port: PORT,
      draftId: 'draft-1',
    })

    expect(result.type.name).toBe('ConnectLauncher')
    expect(result.props.providerId).toBe('google-email')

    const completeUrl = new URL(result.props.completeUrl as string)
    expect(completeUrl.origin).toBe('https://sim.test')
    expect(completeUrl.pathname).toBe('/desktop/connect/complete')
    expect(completeUrl.searchParams.get('state')).toBe(VALID_STATE)
    expect(completeUrl.searchParams.get('port')).toBe(PORT)
    expect(completeUrl.searchParams.get('credentialDraftId')).toBe('draft-1')
  })

  it('rejects a malformed request without reading the session', async () => {
    const invalid = [
      { provider: 'Google', state: VALID_STATE, port: PORT },
      { provider: 'google-email', state: 'short', port: PORT },
      { provider: 'google-email', state: VALID_STATE },
      {
        provider: 'google-email',
        state: VALID_STATE,
        port: PORT,
        draftId: 'bad draft',
      },
    ]

    for (const params of invalid) {
      const result = await renderPage(params)
      expect(result.type.name).toBe('InvalidRequest')
    }
    expect(mockGetSession).not.toHaveBeenCalled()
  })
})
