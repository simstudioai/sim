/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  connectGitHubSearchInstallationBodySchema,
  listGitHubSearchInstallationsResponseSchema,
} from '@/lib/api/contracts/knowledge/github-installations'

describe('GitHub installation setup contracts', () => {
  it('accepts installation identifiers without permitting credential or owner overrides', () => {
    const body = { organizationId: 'org-1', installationId: '12345' }
    expect(connectGitHubSearchInstallationBodySchema.parse(body)).toEqual(body)
    expect(
      connectGitHubSearchInstallationBodySchema.safeParse({ ...body, credentialId: 'foreign' })
        .success
    ).toBe(false)
    for (const installationId of ['', '0', '-1', '1.5', '123/456']) {
      expect(
        connectGitHubSearchInstallationBodySchema.safeParse({ ...body, installationId }).success
      ).toBe(false)
    }
  })

  it('accepts only a fixed GitHub App installation destination', () => {
    const response = {
      success: true,
      available: true,
      needsUserConnection: false,
      installations: [],
    }
    expect(
      listGitHubSearchInstallationsResponseSchema.safeParse({
        ...response,
        installUrl: 'https://github.com/apps/sim-search/installations/new',
      }).success
    ).toBe(true)
    for (const installUrl of [
      'https://example.com/apps/sim-search/installations/new',
      'https://github.com.evil.example/apps/sim-search/installations/new',
      'https://github.com/apps/sim-search/installations/new?redirect_uri=https://example.com',
    ]) {
      expect(
        listGitHubSearchInstallationsResponseSchema.safeParse({ ...response, installUrl }).success
      ).toBe(false)
    }
  })
})
