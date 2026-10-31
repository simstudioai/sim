import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BROWSER_SOURCES, type BrowserSource } from '@/main/browser-import/browser-sources'
import type { BrowserProfile } from '@/main/browser-import/types'
import { emptySkipCounts } from '@/main/browser-import/types'

/**
 * Continuing a sign-in elsewhere and bringing it back, against stand-ins for
 * the only things a test must never touch: the developer's real browser
 * profiles, their Keychain, the browser launcher, and the Electron cookie jar.
 */
vi.mock('electron', () => import('@/test/electron-mock'))
vi.mock('@/main/browser-agent/session', () => ({
  importAgentCookies: vi.fn(async (cookies: unknown[]) => ({
    imported: cookies.length,
    failed: 0,
  })),
}))
vi.mock('@/main/browser-credentials', () => ({
  credentialsAvailable: () => false,
  importCredentials: vi.fn(),
}))
vi.mock('@/main/browser-sites', () => ({ rememberSites: vi.fn(async () => {}) }))
vi.mock('@/main/account-data-generation', () => ({
  captureAccountDataGeneration: () => 0,
  runAccountDataMutation: (_generation: number, operation: () => Promise<unknown>) => operation(),
}))
vi.mock('@/main/browser-import/browser-launch', () => ({ openInBrowserProfile: vi.fn() }))
vi.mock('@/main/browser-import/chromium-profiles', () => ({ listAllBrowserProfiles: vi.fn() }))
vi.mock('@/main/browser-import/chromium-cookies', () => ({ readBrowserCookies: vi.fn() }))
vi.mock('@/main/browser-import/chromium-crypto', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/main/browser-import/chromium-crypto')>()),
  readSafeStoragePassword: vi.fn(async () => 'safe-storage-password'),
}))

const { openInBrowserProfile } = await import('@/main/browser-import/browser-launch')
const { listAllBrowserProfiles } = await import('@/main/browser-import/chromium-profiles')
const { readBrowserCookies } = await import('@/main/browser-import/chromium-cookies')
const { bringSignInBack, cancelSignIn, continueSignIn, getPendingSignIn } = await import(
  '@/main/browser-import'
)

const ARC = BROWSER_SOURCES.find(({ id }) => id === 'arc') as BrowserSource
const PROFILE: BrowserProfile = {
  id: 'arc:Profile 2',
  directory: 'Profile 2',
  label: 'Work',
  source: ARC,
  cookiesPath: '/arc/Profile 2/Cookies',
  loginDataPaths: [],
  faviconsPath: null,
  historyPath: null,
}
const SIGN_IN_URL =
  'https://signin.aws.amazon.com/oauth?redirect_uri=https%3A%2F%2Fconsole.aws.amazon.com'
const request = (url = SIGN_IN_URL, profileId = PROFILE.id) => ({ profileId, tabId: 'tab-1', url })

function readsCookies(count: number) {
  vi.mocked(readBrowserCookies).mockResolvedValue({
    cookies: Array.from({ length: count }, (_, index) => ({
      url: 'https://console.aws.amazon.com/',
      name: `session-${index}`,
      value: 'value',
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'lax' as const,
    })),
    skipped: emptySkipCounts(),
    rowsSeen: count,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(listAllBrowserProfiles).mockResolvedValue([PROFILE])
  vi.mocked(openInBrowserProfile).mockResolvedValue()
  readsCookies(2)
  cancelSignIn('chat-a')
  cancelSignIn('chat-b')
})

describe('continueSignIn', () => {
  it('opens the exact page in the chosen profile and remembers it for the chat', async () => {
    await expect(continueSignIn('chat-a', request())).resolves.toEqual({
      pending: { site: 'amazon.com', browserLabel: 'Arc' },
    })
    expect(openInBrowserProfile).toHaveBeenCalledWith(
      'company.thebrowser.Browser',
      'Profile 2',
      SIGN_IN_URL
    )
    expect(getPendingSignIn('chat-a')).toEqual({ site: 'amazon.com', browserLabel: 'Arc' })
    expect(getPendingSignIn('chat-b')).toBeNull()
  })

  it.each([
    ['plain http', 'http://example.com/login'],
    ['a local file', 'file:///etc/passwd'],
    ['script', 'javascript:alert(1)'],
    ['embedded credentials', 'https://user:secret@example.com/'],
    ['garbage', 'not a url'],
  ])('refuses %s without launching anything', async (_label, url) => {
    await expect(continueSignIn('chat-a', request(url))).resolves.toEqual({
      error: 'unsupported-page',
    })
    expect(openInBrowserProfile).not.toHaveBeenCalled()
  })

  it('refuses a profile it cannot bring a sign-in back from', async () => {
    await expect(
      continueSignIn('chat-a', request(SIGN_IN_URL, 'chrome:Profile 9'))
    ).resolves.toEqual({ error: 'chrome-not-found' })
    vi.mocked(listAllBrowserProfiles).mockResolvedValue([{ ...PROFILE, cookiesPath: null }])
    await expect(continueSignIn('chat-a', request())).resolves.toEqual({
      error: 'chrome-not-found',
    })
    expect(openInBrowserProfile).not.toHaveBeenCalled()
  })

  it('remembers nothing when the browser will not launch', async () => {
    vi.mocked(openInBrowserProfile).mockRejectedValue(new Error('Unable to find application'))

    await expect(continueSignIn('chat-a', request())).resolves.toEqual({ error: 'launch-failed' })
    expect(getPendingSignIn('chat-a')).toBeNull()
  })
})

describe('bringSignInBack', () => {
  it('imports only the handed-off site from that profile, without rescanning profiles', async () => {
    await continueSignIn('chat-a', request())

    await expect(bringSignInBack('chat-a')).resolves.toEqual({
      result: { cookiesImported: 2, cookiesSkipped: 0 },
      handoff: expect.objectContaining({ tabId: 'tab-1', url: SIGN_IN_URL }),
    })
    expect(readBrowserCookies).toHaveBeenCalledWith('/arc/Profile 2/Cookies', expect.any(Buffer), {
      scope: { domain: 'amazon.com', exact: false },
    })
    expect(listAllBrowserProfiles).toHaveBeenCalledOnce()
    expect(getPendingSignIn('chat-a')).toBeNull()
  })

  it('keeps the handoff pending when nothing came back, so the user can retry', async () => {
    await continueSignIn('chat-a', request())
    readsCookies(0)

    await expect(bringSignInBack('chat-a')).resolves.toMatchObject({
      result: { cookiesImported: 0, cookiesSkipped: 0 },
    })
    expect(getPendingSignIn('chat-a')).not.toBeNull()
  })

  it('keeps a newer handoff that replaced the one being brought back', async () => {
    await continueSignIn('chat-a', request())
    const signedIn = await vi.mocked(readBrowserCookies).getMockImplementation()?.(
      '',
      Buffer.alloc(0)
    )
    let finishRead: (() => void) | undefined
    vi.mocked(readBrowserCookies).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRead = () => signedIn && resolve(signedIn)
        })
    )
    const broughtBack = bringSignInBack('chat-a')
    await vi.waitFor(() => expect(finishRead).toBeTypeOf('function'))
    await continueSignIn('chat-a', request('https://accounts.google.com/signin'))
    finishRead?.()
    await expect(broughtBack).resolves.toMatchObject({ result: { cookiesImported: 2 } })

    expect(getPendingSignIn('chat-a')).toEqual({ site: 'google.com', browserLabel: 'Arc' })
  })

  it('answers only to the chat that started the handoff', async () => {
    await continueSignIn('chat-a', request())

    await expect(bringSignInBack('chat-b')).resolves.toEqual({
      result: { cookiesImported: 0, cookiesSkipped: 0, error: 'unknown' },
    })
    expect(readBrowserCookies).not.toHaveBeenCalled()
  })

  it('has nothing to bring back once the user cancels', async () => {
    await continueSignIn('chat-a', request())
    cancelSignIn('chat-a')

    await expect(bringSignInBack('chat-a')).resolves.toMatchObject({ result: { error: 'unknown' } })
    expect(readBrowserCookies).not.toHaveBeenCalled()
  })
})
