import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import { shell } from 'electron'
import {
  classifyBlankChildNavigation,
  classifyNavigation,
  classifyWindowOpen,
  isAuthSurfacePath,
  isSafeExternalUrl,
  matchesHostList,
  openExternalSafe,
} from '@/main/navigation'

const APP = 'https://sim.ai'

describe('classifyNavigation', () => {
  it('keeps same-origin navigation in-app', () => {
    expect(
      classifyNavigation(`${APP}/workspace/ws1/w/wf1`, {
        appOrigin: APP,
        currentUrl: `${APP}/workspace/ws1`,
      })
    ).toBe('in-app')
  })

  it('allows about:blank', () => {
    expect(classifyNavigation('about:blank', { appOrigin: APP })).toBe('in-app')
  })

  it('routes Google from the login surface to the system-browser handoff', () => {
    expect(
      classifyNavigation('https://accounts.google.com/o/oauth2/v2/auth?x=1', {
        appOrigin: APP,
        currentUrl: `${APP}/login`,
      })
    ).toBe('idp-system-login')
  })

  it('routes Microsoft from the signup surface to the system-browser handoff', () => {
    expect(
      classifyNavigation('https://login.microsoftonline.com/common/oauth2/v2.0/authorize', {
        appOrigin: APP,
        currentUrl: `${APP}/signup`,
      })
    ).toBe('idp-system-login')
  })

  it('routes Google from a workspace page to the connect-in-browser intercept', () => {
    expect(
      classifyNavigation('https://accounts.google.com/o/oauth2/v2/auth?scope=drive', {
        appOrigin: APP,
        currentUrl: `${APP}/workspace/ws1/integrations/google-drive`,
      })
    ).toBe('idp-system-connect')
  })

  it('matches system IdP subdomains', () => {
    expect(
      classifyNavigation('https://device.login.microsoftonline.com/', {
        appOrigin: APP,
        currentUrl: `${APP}/workspace/ws1`,
      })
    ).toBe('idp-system-connect')
  })

  it('keeps verified-lenient IdPs in-window from the login surface', () => {
    expect(
      classifyNavigation('https://github.com/login/oauth/authorize?client_id=x', {
        appOrigin: APP,
        currentUrl: `${APP}/login`,
      })
    ).toBe('idp-in-window')
  })

  it('sends unknown hosts from an auth surface to the system browser (SSO safe default)', () => {
    expect(
      classifyNavigation('https://company.okta.com/sso/saml', {
        appOrigin: APP,
        currentUrl: `${APP}/login`,
      })
    ).toBe('idp-system-login')
  })

  it('keeps unknown hosts from workspace pages in-window (integration OAuth is a same-window redirect)', () => {
    expect(
      classifyNavigation('https://api.notion.com/v1/oauth/authorize?x=1', {
        appOrigin: APP,
        currentUrl: `${APP}/workspace/ws1/integrations/notion`,
      })
    ).toBe('idp-in-window')
  })

  it('allows continuation navigation while already on an IdP host', () => {
    expect(
      classifyNavigation('https://github.com/sessions/two-factor', {
        appOrigin: APP,
        currentUrl: 'https://github.com/login',
      })
    ).toBe('idp-in-window')
  })

  it('allows any https navigation inside popups', () => {
    expect(
      classifyNavigation('https://third-party-mcp.example/authorize', {
        appOrigin: APP,
        currentUrl: 'https://other.example/start',
        isPopup: true,
      })
    ).toBe('in-app')
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
  it('classifies blank children (Stripe blank-then-assign)', () => {
    expect(classifyWindowOpen('', '', APP)).toBe('popup-blank')
    expect(classifyWindowOpen('about:blank', '', APP)).toBe('popup-blank')
  })

  it('classifies the MCP OAuth popup by frame name for any https URL', () => {
    expect(classifyWindowOpen(`${APP}/api/mcp/oauth/start`, 'mcp-oauth-srv1', APP)).toBe(
      'popup-mcp'
    )
    expect(classifyWindowOpen('https://mcp.example/authorize', 'mcp-oauth-srv1', APP)).toBe(
      'popup-mcp'
    )
  })

  it('does not let a cross-origin http URL ride the mcp-oauth frame name in-app', () => {
    expect(classifyWindowOpen('http://mcp.example/authorize', 'mcp-oauth-srv1', APP)).toBe(
      'external'
    )
  })

  it('collapses internal new-tab opens into the main window', () => {
    expect(classifyWindowOpen(`${APP}/workspace/ws1/w/wf1`, '', APP)).toBe('popup-internal')
  })

  it('routes external opens to the system browser', () => {
    expect(classifyWindowOpen('https://docs.sim.ai/blocks', '', APP)).toBe('external')
  })

  it('denies non-web schemes', () => {
    expect(classifyWindowOpen('javascript:alert(1)', '', APP)).toBe('deny')
    expect(classifyWindowOpen('file:///tmp/x', 'mcp-oauth-x', APP)).toBe('deny')
  })
})

describe('classifyBlankChildNavigation', () => {
  it('ignores staying blank', () => {
    expect(classifyBlankChildNavigation('about:blank', APP)).toBe('ignore')
  })

  it('routes same-origin assignment into the main window', () => {
    expect(classifyBlankChildNavigation(`${APP}/chat/deployed`, APP)).toBe('internal')
  })

  it('routes external assignment (Stripe portal) to the system browser', () => {
    expect(classifyBlankChildNavigation('https://billing.stripe.com/p/session/x', APP)).toBe(
      'external'
    )
  })

  it('denies non-web schemes', () => {
    expect(classifyBlankChildNavigation('javascript:alert(1)', APP)).toBe('deny')
  })
})

describe('isSafeExternalUrl', () => {
  it('allows https', () => {
    expect(isSafeExternalUrl('https://docs.sim.ai')).toBe(true)
  })

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

  it('rejects non-web schemes', () => {
    for (const url of [
      'file:///etc/passwd',
      'javascript:alert(1)',
      'data:text/html,x',
      'steam://run/1',
      'blob:https://sim.ai/x',
    ]) {
      expect(isSafeExternalUrl(url, true)).toBe(false)
    }
  })

  it('rejects garbage', () => {
    expect(isSafeExternalUrl('not a url')).toBe(false)
    expect(isSafeExternalUrl('')).toBe(false)
  })
})

describe('openExternalSafe', () => {
  beforeEach(() => {
    vi.mocked(shell.openExternal).mockClear()
  })

  it('opens validated URLs', async () => {
    await expect(openExternalSafe('https://docs.sim.ai')).resolves.toBe(true)
    expect(shell.openExternal).toHaveBeenCalledWith('https://docs.sim.ai')
  })

  it('never passes unsafe URLs to the shell', async () => {
    await expect(openExternalSafe('javascript:alert(1)')).resolves.toBe(false)
    await expect(openExternalSafe('file:///etc/passwd', true)).resolves.toBe(false)
    expect(shell.openExternal).not.toHaveBeenCalled()
  })
})

describe('helpers', () => {
  it('matchesHostList covers exact hosts and subdomains', () => {
    expect(matchesHostList('accounts.google.com', ['accounts.google.com'])).toBe(true)
    expect(matchesHostList('sub.accounts.google.com', ['accounts.google.com'])).toBe(true)
    expect(matchesHostList('evilaccounts.google.com.attacker.io', ['accounts.google.com'])).toBe(
      false
    )
    expect(matchesHostList('notaccounts.google.com', ['accounts.google.com'])).toBe(false)
  })

  it('isAuthSurfacePath matches auth routes and their children only', () => {
    expect(isAuthSurfacePath('/login')).toBe(true)
    expect(isAuthSurfacePath('/sso/acme')).toBe(true)
    expect(isAuthSurfacePath('/desktop/auth')).toBe(true)
    expect(isAuthSurfacePath('/workspace/ws1')).toBe(false)
    expect(isAuthSurfacePath('/loginish')).toBe(false)
  })
})
