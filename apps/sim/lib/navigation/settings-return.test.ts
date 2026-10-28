/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from 'vitest'
import { popSettingsReturnUrl, rememberSettingsReturnUrl } from '@/lib/navigation/settings-return'

describe('settings round trips', () => {
  beforeEach(() => sessionStorage.clear())

  it.each(['/workspace/workspace-a', '/o/organization-a'])(
    'restores the complete chat URL in %s without replacing it on section changes',
    (scope) => {
      const original = `${scope}/chat/chat-a?resource=file-a&view=view-a#selection`
      window.history.replaceState(null, '', original)
      rememberSettingsReturnUrl(`${scope}/settings/general`)
      window.history.replaceState(null, '', `${scope}/settings/general`)
      rememberSettingsReturnUrl(`${scope}/settings/profile`)
      window.history.replaceState(null, '', `${scope}/settings/profile`)
      expect(popSettingsReturnUrl(`${scope}/home`)).toBe(original)
      expect(popSettingsReturnUrl(`${scope}/home`)).toBe(`${scope}/home`)
    }
  )

  it('does not carry a return destination into a different organization', () => {
    window.history.replaceState(null, '', '/o/organization-a/chat/chat-a?resource=file-a')
    rememberSettingsReturnUrl('/o/organization-a/settings/general')
    window.history.replaceState(null, '', '/o/organization-b/settings/general')
    expect(popSettingsReturnUrl('/o/organization-b/home')).toBe('/o/organization-b/home')
  })

  it('does not store an origin from outside the destination settings scope', () => {
    window.history.replaceState(null, '', '/workspace/workspace-a/chat/chat-a')
    rememberSettingsReturnUrl('/o/organization-a/settings/general')
    window.history.replaceState(null, '', '/o/organization-a/settings/general')
    expect(popSettingsReturnUrl('/o/organization-a/home')).toBe('/o/organization-a/home')
  })
})
