import { INTEGRATION_METADATA } from '@sim/deployment-config/integration-metadata'
import { describe, expect, it } from 'vitest'
import { OAUTH_PROVIDERS } from '@/lib/oauth/oauth'
import { unconnectedIntegrations } from '@/app/workspace/[workspaceId]/home/components/suggested-actions/connect-candidates'

const SERVICES = Object.values(OAUTH_PROVIDERS).flatMap((provider) =>
  Object.entries(provider.services).map(([id, service]) => ({ ...service, id }))
)

function githubCandidates(connected: string[]) {
  return unconnectedIntegrations(SERVICES, new Set(connected), INTEGRATION_METADATA).filter(
    ({ slug }) => slug === 'github'
  )
}

describe('suggested connect rows', () => {
  it('offers GitHub once, through the service its catalog entry names', () => {
    expect(githubCandidates([]).map(({ service }) => service.id)).toEqual(['github-token'])
  })

  it.each([
    ['a saved personal access token', 'github-service-account'],
    ['a Search OAuth account', 'github-repositories'],
    ['a GitHub App installation', 'github-app-installation'],
  ])('treats GitHub as connected by %s', (_, providerId) => {
    expect(githubCandidates([providerId])).toEqual([])
  })

  it("still offers GitHub when only another integration's credential is saved", () => {
    expect(githubCandidates(['slack', 'gitlab-service-account'])).toHaveLength(1)
  })
})
