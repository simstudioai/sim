import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockRedirect, baseUrl } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockRedirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
  /** Mutable so a test can give the deployment a trailing-slash base URL. */
  baseUrl: { value: 'https://sim.test' },
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: mockGetSession } },
  getSession: vi.fn(),
}))

vi.mock('@/lib/auth/auth-client', () => ({
  client: { oauth2: { link: vi.fn() } },
  signOut: vi.fn(),
}))

vi.mock('@/lib/core/utils/urls', () => ({
  getBaseUrl: () => baseUrl.value,
}))

/** Keeps the landing-page barrel the real shell pulls in out of this graph. */
vi.mock('@/app/desktop/components/desktop-handoff-shell', () => ({
  DesktopHandoffShell: () => null,
}))

vi.mock('next/navigation', () => ({
  redirect: mockRedirect,
}))

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers()),
}))

import DesktopConnectPage from '@/app/desktop/connect/page'

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
    baseUrl.value = 'https://sim.test'
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
