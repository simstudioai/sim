import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import { newChatRoute, settingsRoute } from '@/main/app-routes'

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
    ['a route that only starts like the Platform', '/organizations/x'],
    ['the retired Platform mount, which names no organization', '/org/settings/usage'],
    ['an unsafe route', '//evil.example/o/org-1'],
  ])('resolves settings through the web app from %s', (_label, lastRoute) => {
    expect(settingsRoute(lastRoute)).toBe('/workspace?redirect=settings')
  })
})

describe('newChatRoute', () => {
  it('opens Home in the organization the user was last in', () => {
    expect(newChatRoute('/o/org-1/people')).toBe('/o/org-1/home')
  })

  it("opens the app entry from a workspace route, never the workspace's legacy Home", () => {
    expect(newChatRoute('/workspace/ws-1/workflows')).toBe('/home')
  })
})
