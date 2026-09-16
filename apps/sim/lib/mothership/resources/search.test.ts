/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { mothershipResourceSchema } from '@/lib/api/contracts/mothership-resources'
import { ResourceAddress } from '@/lib/mothership/generated/resources'
import { createSearchResource, searchResourceMatchesOwner } from '@/lib/mothership/resources/search'
import { searchResourceFromToolResult } from '@/lib/mothership/resources/search-tool-result'
import { mergeChatResource, sanitizeChatResources } from '@/lib/mothership/resources/types'

const context = {
  userId: 'reader',
  organizationId: 'org',
  chatId: 'chat',
  toolCallId: 'call',
  copilotToolExecution: true,
  assistantSearch: { source: 'slack' },
}
const output = {
  success: true,
  data: { query: 'safe policy', results: [{ content: 'Private evidence not persisted' }] },
}
describe('Search resource addresses', () => {
  it('projects safe successful query and effective filters without persisting result text', () => {
    const resource = searchResourceFromToolResult(
      { query: 'raw policy', topK: 7 },
      output,
      context
    )!
    expect(resource).toEqual({
      type: 'search',
      id: 'search:organization:org',
      title: 'Search results',
      search: {
        query: 'safe policy',
        scope: { kind: 'organization', organizationId: 'org' },
        filters: { source: 'slack' },
        topK: 7,
      },
    })
    expect(ResourceAddress.parse(resource)).toEqual(resource)
    expect(mothershipResourceSchema.parse(resource)).toEqual(resource)
    expect(sanitizeChatResources([resource])).toEqual([resource])
  })
  it('does not publish failure or non-search results', () => {
    expect(searchResourceFromToolResult({}, { success: false }, context)).toBeUndefined()
    expect(searchResourceFromToolResult({}, { success: true }, context)).toBeUndefined()
  })
  it('updates the existing owner tab with the latest exact retrieval address', () => {
    const first = createSearchResource({
      query: 'first',
      scope: { kind: 'organization', organizationId: 'org' },
    })
    const next = createSearchResource({
      query: 'second',
      scope: { kind: 'organization', organizationId: 'org' },
      filters: { source: 'gmail' },
    })
    expect(first.id).toBe(next.id)
    expect(mergeChatResource(first, next).search).toEqual(next.search)
  })
  it('refuses foreign and mixed scope addresses', () => {
    const search = {
      query: 'policy',
      scope: { kind: 'organization' as const, organizationId: 'org' },
    }
    expect(searchResourceMatchesOwner(search, { organizationId: 'org' })).toBe(true)
    expect(searchResourceMatchesOwner(search, { organizationId: 'other' })).toBe(false)
    expect(searchResourceMatchesOwner(search, { workspaceId: 'workspace' })).toBe(false)
    expect(
      mothershipResourceSchema.safeParse({
        ...createSearchResource(search),
        workspaceId: '01234567-89ab-4cde-8f01-234567890abc',
      }).success
    ).toBe(false)
    expect(
      mothershipResourceSchema.safeParse({ type: 'search', id: 'search:org', title: 'Search' })
        .success
    ).toBe(false)
  })
})
