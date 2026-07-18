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
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
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

  it('mints a token and redirects straight to the 127.0.0.1 loopback callback', async () => {
    await expect(DesktopAuthPage(pageProps({ state: VALID_STATE, port: '54321' }))).rejects.toThrow(
      `NEXT_REDIRECT:http://127.0.0.1:54321/auth/callback?token=tok123456&state=${VALID_STATE}`
    )
  })

  it('reads the session fresh (bypassing the cookie cache) so it never mints against a dead session', async () => {
    await expect(DesktopAuthPage(pageProps({ state: VALID_STATE, port: '54321' }))).rejects.toThrow(
      'NEXT_REDIRECT:'
    )
    expect(mockGetSession).toHaveBeenCalledWith(
      expect.objectContaining({ query: { disableCookieCache: true } })
    )
  })

  it('redirects to login when minting fails', async () => {
    mockGenerateOneTimeToken.mockRejectedValue(new Error('UNAUTHORIZED'))
    await expect(DesktopAuthPage(pageProps({ state: VALID_STATE, port: '54321' }))).rejects.toThrow(
      'NEXT_REDIRECT:/login'
    )
  })
})
