/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { createCredentialGroupOAuthStartUrl } from '@/lib/credential-groups/enrollment-links'

describe('credential group OAuth start links', () => {
  it.each(['https://staging.sim.test', 'http://localhost:3015'])(
    'preserves the generated %s origin and encodes both path identifiers once',
    (origin) => {
      const token = 'fixture/token ?+%'
      const optionId = 'option/with ?+%'
      const url = new URL(
        createCredentialGroupOAuthStartUrl({
          invitationLink: `${origin}/credential-groups/enroll/${encodeURIComponent(token)}?optionId=old&returnTo=accounts#old`,
          optionId,
          returnTo: 'search',
        })
      )
      expect(url.origin).toBe(origin)
      expect(url.pathname).toBe(
        `/api/credential-groups/enroll/${encodeURIComponent(token)}/oauth/${encodeURIComponent(optionId)}`
      )
      expect(url.search).toBe('?returnTo=search')
      expect(url.hash).toBe('')
    }
  )

  it('returns reconnects to account settings', () => {
    expect(
      createCredentialGroupOAuthStartUrl({
        invitationLink: 'https://sim.test/credential-groups/enroll/fixture-token',
        optionId: 'option-1',
        returnTo: 'accounts',
      })
    ).toBe(
      'https://sim.test/api/credential-groups/enroll/fixture-token/oauth/option-1?returnTo=accounts'
    )
  })

  it.each(['/enroll/token', '/credential-groups/enroll/', '/credential-groups/enroll/token/extra'])(
    'rejects a noncanonical enrollment path %s',
    (path) => {
      expect(() =>
        createCredentialGroupOAuthStartUrl({
          invitationLink: `https://sim.test${path}`,
          optionId: 'option-1',
          returnTo: 'search',
        })
      ).toThrow('Invalid credential group enrollment link')
    }
  )
})
