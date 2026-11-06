import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import { settingsRoute } from '@/main/app-routes'

describe('settingsRoute', () => {
  it('opens the settings of the organization the user was last in', () => {
    expect(settingsRoute('/o/org-1/search?q=x')).toBe('/o/org-1/settings/general')
  })

  it('keeps the desktop settings of the workspace the user was last in', () => {
    expect(settingsRoute('/workspace/ws-1/home')).toBe('/workspace/ws-1/settings/desktop')
  })

  it.each([
    ['the workspace picker', '/workspace'],
    ['the app entry', '/home'],
    ['no saved route', undefined],
    ['a route that only starts like an organization', '/oauth/o/org-1'],
    ['an unsafe route', '//evil.example/o/org-1'],
  ])('resolves settings through the web app from %s', (_label, lastRoute) => {
    expect(settingsRoute(lastRoute)).toBe('/workspace?redirect=settings')
  })
})
