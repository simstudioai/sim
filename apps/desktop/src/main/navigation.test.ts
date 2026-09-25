import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import { shell } from 'electron'
import {
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
})
