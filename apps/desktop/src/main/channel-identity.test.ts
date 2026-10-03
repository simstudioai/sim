import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import { DEFAULT_ORIGIN } from '@/main/config'
import { classifyNavigation } from '@/main/navigation'

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
})
