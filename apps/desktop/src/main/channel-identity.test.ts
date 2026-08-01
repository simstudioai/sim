import { describe, expect, it } from 'vitest'
import { APP_NAME_FOR_CHANNEL, channelForOrigin, DEFAULT_ORIGIN } from '@/main/config'
import { classifyNavigation } from '@/main/navigation'
import { DEV, identityForOrigin, LOCAL, PROD, STAGING } from '../../scripts/channels'

/**
 * The packager stamps a bundle name/id from scripts/channels.ts while the app
 * names itself at runtime from config.ts. Nothing linked the two, so they were
 * free to drift — which is how the share build ended up packaging a
 * dev-pointed app under the production identity.
 */
describe('channel identity', () => {
  it('packages every channel under the name it gives itself at runtime', () => {
    for (const identity of [PROD, STAGING, DEV, LOCAL]) {
      expect(APP_NAME_FOR_CHANNEL[channelForOrigin(identity.origin)]).toBe(identity.name)
    }
  })

  it('resolves an unset baked origin to the same channel as the app default', () => {
    expect(identityForOrigin('')).toBe(PROD)
    expect(PROD.origin).toBe(DEFAULT_ORIGIN)
    expect(channelForOrigin(DEFAULT_ORIGIN)).toBe('prod')
  })

  it('treats an unrecognized (self-hosted) origin as production', () => {
    expect(identityForOrigin('https://sim.acme-corp.example')).toBe(PROD)
  })
})

/**
 * The shipped default must be an origin the environment SERVES. When it was
 * the apex (which 301s to www) the window sat one origin away from appOrigin,
 * so `fromAuthSurface` was never true and social login was misread as an
 * integration connect — the "finish connecting in your browser" dialog
 * instead of the login handoff.
 */
describe('social login from the shipped default origin', () => {
  it('hands off to the system browser instead of offering a connect', () => {
    expect(
      classifyNavigation('https://accounts.google.com/o/oauth2/v2/auth?client_id=x', {
        appOrigin: DEFAULT_ORIGIN,
        currentUrl: `${DEFAULT_ORIGIN}/login`,
      })
    ).toBe('idp-system-login')
  })

  it('still offers the connect dialog for an integration connect mid-workspace', () => {
    expect(
      classifyNavigation('https://accounts.google.com/o/oauth2/v2/auth?client_id=x', {
        appOrigin: DEFAULT_ORIGIN,
        currentUrl: `${DEFAULT_ORIGIN}/workspace/ws1/w/wf1`,
      })
    ).toBe('idp-system-connect')
  })
})
