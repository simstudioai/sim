/**
 * @vitest-environment node
 */
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
    vi.clearAllMocks()
    baseUrl.value = 'https://sim.test'
    mockGetSession.mockResolvedValue({ user: { id: 'user-1', email: 'user@example.com' } })
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

  it('keeps the complete URL absolute when no draft rides along', async () => {
    const result = await renderPage({
      provider: 'google-email',
      state: VALID_STATE,
      port: PORT,
    })

    expect(result.type.name).toBe('ConnectLauncher')
    expect(() => new URL(result.props.completeUrl as string)).not.toThrow()
  })

  it('keeps the completion route intact when the deployment base URL has a trailing slash', async () => {
    // `//desktop/connect/complete` matches no route, so the provider result
    // would never reach the loopback and the connect would hang.
    baseUrl.value = 'https://sim.test/'

    const launcher = await renderPage({
      provider: 'google-email',
      state: VALID_STATE,
      port: PORT,
    })
    expect(new URL(launcher.props.completeUrl as string).pathname).toBe('/desktop/connect/complete')

    await expect(
      DesktopConnectPage(
        pageProps({
          provider: 'google-email',
          state: VALID_STATE,
          port: PORT,
          workspaceId: 'workspace-1',
        })
      )
    ).rejects.toThrow('NEXT_REDIRECT:')
    const callbackUrl = new URL(mockRedirect.mock.calls[0][0]).searchParams.get('callbackURL')
    expect(new URL(callbackUrl as string).pathname).toBe('/desktop/connect/complete')
  })

  it('sends a workspace-scoped connect to the authorize route with an absolute callback', async () => {
    await expect(
      DesktopConnectPage(
        pageProps({
          provider: 'google-email',
          state: VALID_STATE,
          port: PORT,
          workspaceId: 'workspace-1',
        })
      )
    ).rejects.toThrow('NEXT_REDIRECT:')

    const authorize = new URL(mockRedirect.mock.calls[0][0])
    expect(authorize.pathname).toBe('/api/auth/oauth2/authorize')
    expect(authorize.searchParams.get('providerId')).toBe('google-email')
    expect(authorize.searchParams.get('workspaceId')).toBe('workspace-1')
    expect(authorize.searchParams.get('callbackURL')).toBe(
      `https://sim.test/desktop/connect/complete?state=${VALID_STATE}&port=${PORT}`
    )
  })

  it.each(['trello', 'instagram', 'shopify'])(
    'starts %s through its dedicated authorize route in the system browser',
    async (provider) => {
      await expect(
        DesktopConnectPage(
          pageProps({
            provider,
            state: VALID_STATE,
            port: PORT,
            draftId: 'draft-1',
          })
        )
      ).rejects.toThrow('NEXT_REDIRECT:')

      const authorize = new URL(mockRedirect.mock.calls[0][0])
      expect(authorize.pathname).toBe(`/api/auth/${provider}/authorize`)
      expect(authorize.searchParams.get('draftId')).toBe('draft-1')
      expect(authorize.searchParams.get('returnUrl')).toBe(
        `https://sim.test/desktop/connect/complete?state=${VALID_STATE}&port=${PORT}`
      )
    }
  )

  it('rejects a malformed request without reading the session', async () => {
    const invalid = [
      { provider: 'Google', state: VALID_STATE, port: PORT },
      { provider: 'google-email', state: 'short', port: PORT },
      { provider: 'google-email', state: VALID_STATE },
      { provider: 'google-email', state: VALID_STATE, port: PORT, draftId: 'bad draft' },
    ]

    for (const params of invalid) {
      const result = await renderPage(params)
      expect(result.type.name).toBe('InvalidRequest')
    }
    expect(mockGetSession).not.toHaveBeenCalled()
  })
})
