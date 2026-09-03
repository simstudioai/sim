import { describe, expect, it } from 'vitest'
import { OAUTH_PROVIDERS } from './oauth'
import { getScopeDescription, OAUTH_SCOPES } from './scopes'

describe('getScopeDescription', () => {
  it.concurrent('uses provider-specific labels for Bitbucket scope names', () => {
    expect(getScopeDescription('account', 'bitbucket')).toBe(
      'View your Bitbucket account and workspace memberships'
    )
    expect(getScopeDescription('pipeline:write', 'bitbucket')).toBe('Run and stop pipelines')
    expect(getScopeDescription('webhook', 'bitbucket')).toBe('Manage repository webhooks')
  })

  /**
   * `read` and `write` are issued by Linear, Trello and Reddit alike, so the
   * shared label cannot describe any of them precisely. Each provider that
   * reuses the name gets its own.
   */
  it.concurrent('disambiguates scope names more than one provider issues', () => {
    expect(getScopeDescription('read', 'trello')).toBe(
      'View boards, lists, and cards you can access'
    )
    expect(getScopeDescription('read', 'reddit')).toBe(
      'View posts, comments, and subreddits through your account'
    )
    expect(getScopeDescription('read', 'linear')).toBe('Read access to connected account data')
  })

  it.concurrent('preserves the existing Reddit meaning of the account scope', () => {
    expect(getScopeDescription('account', 'reddit')).toBe('Update account preferences and settings')
    expect(getScopeDescription('account')).toBe('Update account preferences and settings')
  })

  /**
   * The consent screen is where a user decides what to grant, so a write scope
   * has to read as one. `w_member_social` previously said 'Access LinkedIn
   * profile', describing a posting grant as a profile read.
   *
   * The wording tracks LinkedIn's own: "Post, comment, and like posts on behalf
   * of an authenticated member." It names all three verbs even though Sim only
   * posts -- the label describes the grant the token carries, not Sim's current
   * use of it, and LinkedIn's scopes cannot be sub-selected.
   */
  it.concurrent('describes w_member_social as the write grant it is', () => {
    const description = getScopeDescription('w_member_social', 'linkedin')

    expect(description).toBe('Post, comment, and like posts on your behalf')
    expect(description).not.toMatch(/access .*profile/i)
  })

  it.concurrent('leaves the read-only LinkedIn scopes read-only', () => {
    expect(getScopeDescription('profile', 'linkedin')).toBe('Access profile information')
    expect(getScopeDescription('email', 'linkedin')).toBe('Access email address')
  })
})

describe('OAUTH_SCOPES', () => {
  /**
   * The table lives apart from `OAUTH_PROVIDERS` so the docs generator can import
   * it without pulling in React icons. That split is only safe while the two
   * agree: a service whose scopes went missing would silently request nothing,
   * and an orphaned entry would publish scopes no consent screen asks for.
   */
  it.concurrent('covers exactly the services declared in OAUTH_PROVIDERS', () => {
    const declared = Object.values(OAUTH_PROVIDERS)
      .flatMap((provider) => Object.keys(provider.services))
      .sort()

    expect(Object.keys(OAUTH_SCOPES).sort()).toEqual(declared)
  })

  it.concurrent('requests every declared scope at authorization time', () => {
    for (const [serviceId, scopes] of Object.entries(OAUTH_SCOPES)) {
      const service = Object.values(OAUTH_PROVIDERS).find(
        (provider) => provider.services[serviceId]
      )?.services[serviceId]

      expect(service?.scopes, serviceId).toEqual(expect.arrayContaining([...scopes]))
    }
  })
})
