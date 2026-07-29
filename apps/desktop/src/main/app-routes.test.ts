import { describe, expect, it } from 'vitest'
import { newChatRoute, settingsRoute } from '@/main/app-routes'

describe('app routes', () => {
  it('derives the new-chat route from the last workspace route', () => {
    expect(newChatRoute('/workspace/ws1/w/wf2')).toBe('/workspace/ws1/home')
    expect(newChatRoute('/workspace/ws1/home?resource=r1')).toBe('/workspace/ws1/home')
    expect(newChatRoute('/account')).toBe('/workspace')
    expect(newChatRoute(undefined)).toBe('/workspace')
    expect(newChatRoute('//evil.example')).toBe('/workspace')
  })

  it('derives the settings route from the last workspace route', () => {
    expect(settingsRoute('/workspace/ws1/w/wf2')).toBe('/workspace/ws1/settings/desktop')
    expect(settingsRoute('/account')).toBe('/workspace')
    expect(settingsRoute(undefined)).toBe('/workspace')
    expect(settingsRoute('//evil.example')).toBe('/workspace')
  })
})
