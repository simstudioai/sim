import { describe, expect, it } from 'vitest'
import {
  APP_ENTRY_PATH,
  isAppSurfacePath,
  organizationRoutes,
  WORKSPACES_PATH,
} from '@/lib/navigation/paths'

describe('isAppSurfacePath', () => {
  it.each([
    APP_ENTRY_PATH,
    WORKSPACES_PATH,
    '/workspace/ws-1/home',
    '/o',
    '/o/org-1',
    '/o/org-1/chat/c-1',
  ])('gates %s', (pathname) => {
    expect(isAppSurfacePath(pathname)).toBe(true)
  })

  it.each(['/', '/login', '/homepage', '/organizations', '/workspaces', '/other'])(
    'leaves %s public',
    (pathname) => {
      expect(isAppSurfacePath(pathname)).toBe(false)
    }
  )
})

describe('organizationRoutes', () => {
  it('builds every destination under the organization root', () => {
    const routes = organizationRoutes('org-1')
    expect(routes.root).toBe('/o/org-1')
    expect(routes.home).toBe('/o/org-1/home')
    expect(routes.search).toBe('/o/org-1/search')
    expect(routes.settings).toBe('/o/org-1/settings')
    expect(routes.settingsSection('members')).toBe('/o/org-1/settings/members')
    expect(routes.chat('c-1')).toBe('/o/org-1/chat/c-1')
  })
})
