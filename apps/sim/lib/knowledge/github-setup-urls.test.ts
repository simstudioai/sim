/** @vitest-environment node */
import { describe, expect, it, vi } from 'vitest'
import {
  completeGitHubSearchSetupQuerySchema,
  gitHubSearchSetupScopeSchema,
  selectGitHubSearchSetupBodySchema,
  startGitHubSearchSetupBodySchema,
} from '@/lib/api/contracts/knowledge/github-setup'

vi.mock('@/lib/core/utils/urls', () => ({ getBaseUrl: () => 'https://sim.example' }))

import {
  githubSetupCompletionUrl,
  githubSetupContinueUrl,
  githubSetupPageUrl,
} from '@/lib/knowledge/github-setup-urls'

const scope = {
  organizationId: 'org/with?special&characters',
  setupId: '550e8400-e29b-41d4-a716-446655440000',
}
describe('GitHub setup URLs and contracts', () => {
  it.each([githubSetupPageUrl, githubSetupContinueUrl])(
    'uses the configured origin and encodes scope as values',
    (build) => {
      const url = new URL(build(scope))
      expect(url.origin).toBe('https://sim.example')
      expect(url.searchParams.get('organizationId')).toBe(scope.organizationId)
      expect(url.searchParams.get('setupId')).toBe(scope.setupId)
      expect(url.hash).toBe('')
    }
  )
  it('correlates the generic completion page without installation IDs or provider state', () => {
    const url = new URL(githubSetupCompletionUrl(scope.setupId, 'denied'))
    expect(url.pathname).toBe('/credential-groups/complete')
    expect([...url.searchParams]).toEqual([
      ['completionId', scope.setupId],
      ['oauth', 'denied'],
    ])
  })
  it('admits explicit install intent only on start and accepts no client redirect target', () => {
    const valid = { organizationId: 'org', setupId: scope.setupId }
    expect(
      startGitHubSearchSetupBodySchema.safeParse({ ...valid, intent: 'install' }).success
    ).toBe(true)
    expect(gitHubSearchSetupScopeSchema.safeParse({ ...valid, intent: 'install' }).success).toBe(
      false
    )
    expect(
      startGitHubSearchSetupBodySchema.safeParse({ ...valid, returnTo: 'https://evil.example' })
        .success
    ).toBe(false)
    expect(
      selectGitHubSearchSetupBodySchema.safeParse({
        ...valid,
        action: { kind: 'select', installationId: '0' },
      }).success
    ).toBe(false)
    expect(
      completeGitHubSearchSetupQuerySchema.safeParse({ state: 'guessed', installation_id: '42' })
        .success
    ).toBe(false)
  })
})
