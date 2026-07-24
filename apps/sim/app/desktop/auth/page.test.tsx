/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockGenerateOneTimeToken, mockRedirect } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockGenerateOneTimeToken: vi.fn(),
  mockRedirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { generateOneTimeToken: mockGenerateOneTimeToken, getSession: mockGetSession } },
  getSession: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: mockRedirect,
}))

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers()),
}))

import DesktopAuthPage from '@/app/desktop/auth/page'

const VALID_STATE = 'a'.repeat(32)

function pageProps(params: Record<string, string>) {
  return { searchParams: Promise.resolve(params) }
}

describe('DesktopAuthPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1', email: 'user@example.com' } })
    mockGenerateOneTimeToken.mockResolvedValue({ token: 'tok123456' })
  })

  it('rejects a missing/malformed state or missing port without minting a token', async () => {
    const invalid = [
      {},
      { state: 'short', port: '54321' },
      { state: 'bad state!bad state!', port: '54321' },
      { state: VALID_STATE },
      { state: VALID_STATE, port: '80' },
    ]
    for (const params of invalid) {
      const result = await DesktopAuthPage(pageProps(params))
      expect((result as { type: { name: string } }).type.name).toBe('InvalidRequest')
    }
    expect(mockGetSession).not.toHaveBeenCalled()
    expect(mockGenerateOneTimeToken).not.toHaveBeenCalled()
  })

  it('redirects a signed-out browser to login with itself as callbackUrl', async () => {
    mockGetSession.mockResolvedValue(null)
    await expect(DesktopAuthPage(pageProps({ state: VALID_STATE, port: '54321' }))).rejects.toThrow(
      `NEXT_REDIRECT:/login?callbackUrl=${encodeURIComponent(
        `/desktop/auth?state=${VALID_STATE}&port=54321`
      )}`
    )
    expect(mockGenerateOneTimeToken).not.toHaveBeenCalled()
  })

  it('renders the confirm screen for a signed-in browser WITHOUT minting a token', async () => {
    // The gesture gate is the security boundary: state and port are
    // attacker-choosable in a crafted link, so a bare GET must never mint a
    // token — only the client-side Continue click may.
    const result = (await DesktopAuthPage(
      pageProps({ state: VALID_STATE, port: '54321' })
    )) as unknown as {
      type: { name: string }
      props: Record<string, unknown>
    }
    expect(result.type.name).toBe('AuthorizeHandoff')
    expect(result.props).toEqual({
      state: VALID_STATE,
      port: 54321,
      email: 'user@example.com',
    })
    expect(mockGenerateOneTimeToken).not.toHaveBeenCalled()
  })

  it('reads the session fresh (bypassing the cookie cache) so it never confirms a dead session', async () => {
    await DesktopAuthPage(pageProps({ state: VALID_STATE, port: '54321' }))
    expect(mockGetSession).toHaveBeenCalledWith(
      expect.objectContaining({ query: { disableCookieCache: true } })
    )
  })
})
