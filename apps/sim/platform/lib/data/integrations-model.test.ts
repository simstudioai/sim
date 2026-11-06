/**
 * @vitest-environment node
 *
 * The generated metadata trails the live-search catalog. Failure mode: a live-search provider it has
 * not caught up with reading as a generic account, with the wrong guide and no resource to scope.
 */
import { SIM_DOCS_URL } from '@sim/utils/site'
import { describe, expect, it, vi } from 'vitest'
import type { MemberIntegration } from '@/lib/credential-groups/member-integrations'
import { LIVE_SEARCH_SCOPE_FIELDS } from '@/lib/sim-search/live/policy-schema'

const { entries } = vi.hoisted(() => ({ entries: { current: [] as unknown[] } }))
vi.mock('@/platform/lib/integrations/metadata.generated', () => ({
  providerMetadata: [
    { id: 'documented', setupGuideUrl: 'https://docs.example/documented', searchResource: 'Pages' },
  ],
  memberSecretMetadata: {},
}))
vi.mock('@/lib/credential-groups/member-integrations', () => ({
  memberIntegrationEntries: () => entries.current,
}))

import { toOrganizationIntegrations } from '@/platform/lib/data/integrations-model'

function guideOf(provider: string) {
  const entry: Partial<MemberIntegration> = {
    id: provider,
    provider,
    name: provider,
    accounts: [],
    permissionAccountIds: [],
    reconnectAccountIds: [],
    ready: true,
  }
  entries.current = [entry]
  // double-cast-allowed: the adapter reads the entries above, and this mock supplies them
  const [integration] = toOrganizationIntegrations({} as never, [])
  return { url: integration?.setupGuideUrl, resource: integration?.searchResource }
}

describe('an integration’s guide and resource', () => {
  it('gives a live-search provider missing from the metadata its own guide and label', () => {
    expect(guideOf('gmail')).toEqual({
      url: `${SIM_DOCS_URL}/search/gmail`,
      resource: LIVE_SEARCH_SCOPE_FIELDS.gmail?.label,
    })
  })

  it('gives any other unknown provider the general guide and no resource', () => {
    expect(guideOf('no_such_provider')).toEqual({
      url: `${SIM_DOCS_URL}/search/connect-your-account`,
      resource: null,
    })
  })

  it('prefers the metadata when it has an answer', () => {
    expect(guideOf('documented')).toEqual({
      url: 'https://docs.example/documented',
      resource: 'Pages',
    })
  })
})
