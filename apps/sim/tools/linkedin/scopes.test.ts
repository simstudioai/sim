/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { getScopeDescription } from '@/lib/oauth/utils'

/**
 * `w_member_social` is a write scope: LinkedIn defines it as "Post, comment and like posts on
 * behalf of an authenticated member". The string resolved here is what the OAuth connect modal
 * renders under "Permissions requested", so it is asserted through `getScopeDescription` rather
 * than against the literal, which would still pass if a provider override shadowed it.
 */
describe('LinkedIn OAuth scope descriptions', () => {
  it('describes w_member_social as posting on the member behalf, not as profile access', () => {
    const description = getScopeDescription('w_member_social', 'linkedin')

    expect(description).toBe('Post, comment, and like posts on your behalf')
    expect(description.toLowerCase()).not.toContain('profile')
  })

  it('resolves the same description without a provider id', () => {
    expect(getScopeDescription('w_member_social')).toBe(
      getScopeDescription('w_member_social', 'linkedin')
    )
  })
})
