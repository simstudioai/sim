import { describe, expect, it } from 'vitest'
import { mothershipResourceSchema } from '@/lib/api/contracts/mothership-resources'
import { ResourceAddress } from '@/lib/mothership/generated/resources'
import { createSearchResource, searchResourceMatchesOwner } from '@/lib/mothership/resources/search'
import {
  searchResourceFromToolResult,
  searchResultFromToolResult,
} from '@/lib/mothership/resources/search-tool-result'
import { mergeChatResource, sanitizeChatResources } from '@/lib/mothership/resources/types'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const context = {
  userId: 'reader',
  requestMode: 'assistant' as const,
  organizationId: 'org',
  chatId: 'chat',
  toolCallId: 'call',
  copilotToolExecution: true,
  assistantSearch: { source: 'slack' },
  resolvedSecretTraceRegistry: new ResolvedSecretTraceRegistry([], {
    userId: 'reader',
    organizationId: 'org',
  }),
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
  it('keeps date-only and native search addresses for an exact result-panel refresh', () => {
    const nativeQueries = [
      { provider: 'github' as const, query: 'repo:simstudioai/sim deployment' },
    ]
    const resource = searchResourceFromToolResult(
      {
        query: '',
        startDate: '2026-09-22T00:00:00Z',
        nativeQueries,
      },
      { success: true, data: { query: '', results: [] } },
      context
    )!
    expect(resource.search).toMatchObject({
      query: '',
      filters: { source: 'slack', startDate: '2026-09-22T00:00:00Z' },
      nativeQueries,
    })
    expect(ResourceAddress.parse(resource)).toEqual(resource)
  })
  it.each(['agent', undefined] as const)(
    'does not open a panel for Build mode (%s)',
    (requestMode) => {
      expect(
        searchResourceFromToolResult({ query: 'policy' }, output, { ...context, requestMode })
      ).toBeUndefined()
    }
  )
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

it('projects complete authorized search data separately and strips extra tool-only fields', () => {
  const data = {
    query: 'policy',
    results: [],
    retrieval: { status: 'partial', timedOutLegs: ['vector'] },
    privateDebug: 'not retained',
  }
  expect(searchResultFromToolResult({ success: true, data }, 'reader')).toEqual({
    actorUserId: 'reader',
    data: {
      query: 'policy',
      results: [],
      retrieval: { status: 'partial', timedOutLegs: ['vector'] },
    },
  })
  expect(searchResultFromToolResult({ success: false, data })).toBeUndefined()
  expect(searchResultFromToolResult({ success: true, data: { query: 'policy' } })).toBeUndefined()
})

it('round-trips cited-source addresses and replaces their answer without copying evidence', () => {
  const first = {
    type: 'sources' as const,
    id: 'cited-sources',
    title: 'Sources',
    sources: { messageId: 'answer-1' },
  }
  const next = { ...first, sources: { messageId: 'answer-2', requestId: 'run-2' } }
  expect(ResourceAddress.parse(first)).toEqual(first)
  expect(mothershipResourceSchema.parse(next)).toEqual(next)
  expect(sanitizeChatResources([next])).toEqual([next])
  expect(mergeChatResource(first, next)).toEqual(next)
  expect(mothershipResourceSchema.safeParse({ ...next, sources: undefined }).success).toBe(false)
})
