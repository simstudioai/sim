import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import { shell } from 'electron'
import {
  appLinkTarget,
  classifyNavigation,
  classifyWindowOpen,
  isSafeExternalUrl,
  openExternalSafe,
} from '@/main/navigation'

const APP = 'https://www.sim.ai'

describe('classifyNavigation', () => {
  it('routes every sign-in to the system browser, including IdPs that tolerate embedding', () => {
    // GitHub used to be kept in-window. Embedded, it is a one-way door (no
    // browser chrome to back out of) and it splits better-auth's OAuth state
    // cookie across two user agents, which comes back `state_mismatch`.
    expect(
      classifyNavigation('https://github.com/login/oauth/authorize?client_id=x', {
        appOrigin: APP,
        currentUrl: `${APP}/login`,
      })
    ).toBe('idp-system-login')
  })

  it('routes non-handoff integration departures out of the privileged app window', () => {
    expect(
      classifyNavigation('https://github.com/login/oauth/authorize?client_id=x', {
        appOrigin: APP,
        currentUrl: `${APP}/workspace/ws1/integrations/github`,
      })
    ).toBe('external')
  })

  it('sends unknown hosts from an auth surface to the system browser (SSO safe default)', () => {
    expect(
      classifyNavigation('https://company.okta.com/sso/saml', {
        appOrigin: APP,
        currentUrl: `${APP}/login`,
      })
    ).toBe('idp-system-login')
  })

  it('does not infer OAuth from an unknown cross-origin workspace navigation', () => {
    expect(
      classifyNavigation('https://api.notion.com/v1/oauth/authorize?x=1', {
        appOrigin: APP,
        currentUrl: `${APP}/workspace/ws1/integrations/notion`,
      })
    ).toBe('external')
  })

  it('does not keep arbitrary cross-origin continuation pages in the app window', () => {
    expect(
      classifyNavigation('https://github.com/sessions/two-factor', {
        appOrigin: APP,
        currentUrl: 'https://github.com/login',
      })
    ).toBe('external')
  })

  it('sends mailto links to the mail client', () => {
    expect(
      classifyNavigation('mailto:support@sim.ai', { appOrigin: APP, currentUrl: `${APP}/login` })
    ).toBe('external')
  })

  it('denies non-web schemes everywhere', () => {
    for (const url of [
      'javascript:alert(1)',
      'file:///etc/passwd',
      'data:text/html,x',
      'sim://auth',
    ]) {
      expect(classifyNavigation(url, { appOrigin: APP, currentUrl: `${APP}/login` })).toBe('deny')
      expect(classifyNavigation(url, { appOrigin: APP, isPopup: true })).toBe('deny')
    }
  })
})

describe('classifyWindowOpen', () => {
  it('sends mailto popups to the mail client instead of denying them', () => {
    expect(classifyWindowOpen('mailto:support@sim.ai', '_blank', APP)).toBe('external')
  })

  it('does not let a cross-origin http URL ride the mcp-oauth frame name in-app', () => {
    expect(classifyWindowOpen('http://mcp.example/authorize', 'mcp-oauth-srv1', APP)).toBe(
      'external'
    )
  })
})

describe('isSafeExternalUrl', () => {
  it('rejects credentials in the URL', () => {
    expect(isSafeExternalUrl('https://user@evil.example')).toBe(false)
    expect(isSafeExternalUrl('https://user:pass@evil.example')).toBe(false)
  })

  it('allows http only for loopback hosts and only when enabled', () => {
    expect(isSafeExternalUrl('http://localhost:3000', true)).toBe(true)
    expect(isSafeExternalUrl('http://127.0.0.1:3000', true)).toBe(true)
    expect(isSafeExternalUrl('http://localhost:3000', false)).toBe(false)
    expect(isSafeExternalUrl('http://evil.example', true)).toBe(false)
  })
})

describe('openExternalSafe', () => {
  beforeEach(() => {
    vi.mocked(shell.openExternal).mockClear()
  })

  it('never passes unsafe URLs to the shell', async () => {
    await expect(openExternalSafe('javascript:alert(1)')).resolves.toBe(false)
    await expect(openExternalSafe('file:///etc/passwd', true)).resolves.toBe(false)
    expect(shell.openExternal).not.toHaveBeenCalled()
  })

  it.each([
    'mailto:support@sim.ai',
    'MAILTO:support@sim.ai,help@sim.ai?subject=Desktop%20offline&body=Hi%0Athere',
    'mailto:?to=support@sim.ai&cc=a@b.example',
  ])('hands the well-formed mailto %s to the system mail client', async (url) => {
    await expect(openExternalSafe(url)).resolves.toBe(true)
    expect(shell.openExternal).toHaveBeenCalledWith(url)
  })

  it.each([
    ['an attachment field', 'mailto:a@b.example?attach=/etc/passwd'],
    ['an unlisted header', 'mailto:a@b.example?X-Header=y'],
    ['a non-address recipient field', 'mailto:a@b.example?cc=file:///etc/passwd'],
    ['unencoded whitespace', 'mailto:a@b.example?subject=a b'],
    ['an encoded header injection', 'mailto:a@b.example%0d%0aBcc:c@d.example'],
    ['a fragment', 'mailto:a@b.example#frag'],
  ])('refuses a mailto with %s', async (_rule, url) => {
    await expect(openExternalSafe(url)).resolves.toBe(false)
    expect(shell.openExternal).not.toHaveBeenCalled()
  })
})

describe('appLinkTarget', () => {
  it.each([
    'file:///etc/passwd',
    'javascript:alert(1)',
    'ms-msdt:id',
    'search-ms:query=x',
    'ms-cxh-full://0',
    'local+app://x',
    'jnlp://evil.example/app.jnlp',
    'x-man-page://ls',
    'c:/Windows/System32/calc.exe',
    'https://example.com',
  ])('refuses %s', (url) => {
    expect(appLinkTarget(url)).toBeNull()
  })

  it('refuses credentials, control characters, oversize URLs, and unsafe mail links', () => {
    expect(appLinkTarget('zoommtg://user:pass@zoom.us/join')).toBeNull()
    expect(appLinkTarget('zoommtg://zoom.us/join?x=1\n')).toBeNull()
    expect(appLinkTarget('zoommtg://zoom.us/join?x= 1')).toBeNull()
    expect(appLinkTarget(`zoommtg://zoom.us/join?x=${'a'.repeat(2_048)}`)).toBeNull()
    expect(appLinkTarget('mailto:a@example.com?attach=/etc/passwd')).toBeNull()
  })

  it('hands the operating system the parser-rebuilt URL of an app link', () => {
    expect(appLinkTarget('ZoomMtg://zoom.us/join?confno=123&pwd=abc')).toEqual({
      url: 'zoommtg://zoom.us/join?confno=123&pwd=abc',
      scheme: 'zoommtg',
    })
    expect(appLinkTarget('mailto:a@example.com?subject=Hi')?.scheme).toBe('mailto')
  })

  it('opens an app link only on the app-link path, and only in its rebuilt form', async () => {
    vi.mocked(shell.openExternal).mockClear()
    await expect(openExternalSafe('zoommtg://zoom.us/join')).resolves.toBe(false)
    await expect(
      openExternalSafe('ZoomMtg://zoom.us/join', false, { appLink: true })
    ).resolves.toBe(false)
    await expect(
      openExternalSafe('zoommtg://zoom.us/join', false, { appLink: true })
    ).resolves.toBe(true)
    expect(shell.openExternal).toHaveBeenCalledExactlyOnceWith('zoommtg://zoom.us/join')
  })
})
