/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { extractErrorMessage } from '@/tools/error-extractors'
import { harmonicBatchGetPeopleTool } from '@/tools/harmonic/batch_get_people'
import { harmonicGetPeopleSavedSearchResultsTool } from '@/tools/harmonic/get_people_saved_search_results'
import { harmonicListPeopleSavedSearchesTool } from '@/tools/harmonic/list_people_saved_searches'
import { harmonicSearchPeopleScoutTool } from '@/tools/harmonic/search_people_scout'
import { HARMONIC_SCOUT_PEOPLE_SCHEMA } from '@/tools/harmonic/utils'
import type { ToolConfig } from '@/tools/types'

const allTools = [
  harmonicSearchPeopleScoutTool,
  harmonicListPeopleSavedSearchesTool,
  harmonicGetPeopleSavedSearchResultsTool,
  harmonicBatchGetPeopleTool,
] as const

const buildUrl = (tool: ToolConfig, params: Record<string, unknown>): string =>
  typeof tool.request.url === 'function' ? tool.request.url(params) : tool.request.url

const buildBody = (tool: ToolConfig, params: Record<string, unknown>): Record<string, unknown> => {
  const body = tool.request.body?.(params)
  if (!body || typeof body !== 'object' || body instanceof FormData) {
    throw new Error('Expected a JSON request body')
  }
  return body as Record<string, unknown>
}

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })

const expectOutputParity = (tool: ToolConfig, output: Record<string, unknown>) => {
  expect(Object.keys(output).sort()).toEqual(Object.keys(tool.outputs ?? {}).sort())
}

const personFixture = {
  entity_urn: 'urn:harmonic:person:123',
  id: 123,
  full_name: 'Ada Lovelace',
  first_name: 'Ada',
  last_name: 'Lovelace',
  linkedin_headline: 'Forward Deployed Engineer',
  profile_picture_url: 'https://images.example.com/ada.jpg',
  contact: {
    primary_email: 'ada@example.com',
    emails: ['ada@example.com', 'ada.personal@example.com'],
    exec_emails: ['ada.exec@example.com'],
    phone_numbers: ['+1 415 555 0100'],
  },
  location: {
    address_formatted: 'San Francisco, California, United States',
    city: 'San Francisco',
    state: 'California',
    country: 'United States',
  },
  socials: {
    LINKEDIN: { url: 'https://www.linkedin.com/in/ada' },
    TWITTER: { url: 'https://x.com/ada' },
  },
  experience: [
    {
      title: 'Forward Deployed Engineer',
      company: 'urn:harmonic:company:1',
      company_name: 'Enterprise One',
      is_current_position: true,
    },
    {
      title: 'Advisor',
      company: 'urn:harmonic:company:2',
      company_name: 'Enterprise Two',
      is_current_position: true,
    },
    {
      title: 'Engineer',
      company: 'urn:harmonic:company:3',
      company_name: 'Old Company',
      is_current_position: false,
    },
  ],
  current_company_urns: ['urn:harmonic:company:1', 'urn:harmonic:company:2'],
  is_redacted: false,
}

describe('Harmonic authentication and registry-facing contracts', () => {
  it('exports exactly the four supported snake_case tool IDs', () => {
    expect(allTools.map((tool) => tool.id)).toEqual([
      'harmonic_search_people_scout',
      'harmonic_list_people_saved_searches',
      'harmonic_get_people_saved_search_results',
      'harmonic_batch_get_people',
    ])
  })

  it('uses the exact documented HTTP method and canonical endpoint for every operation', () => {
    const descriptors: Array<[ToolConfig, Record<string, unknown>, string, string]> = [
      [
        harmonicSearchPeopleScoutTool,
        { query: 'find FDEs' },
        'POST',
        'https://api.harmonic.ai/scout/tasks/wait',
      ],
      [harmonicListPeopleSavedSearchesTool, {}, 'GET', 'https://api.harmonic.ai/savedSearches'],
      [
        harmonicGetPeopleSavedSearchResultsTool,
        { savedSearchId: 'search-1' },
        'GET',
        'https://api.harmonic.ai/savedSearches:results/search-1?size=50',
      ],
      [
        harmonicBatchGetPeopleTool,
        { personIds: [1] },
        'POST',
        'https://api.harmonic.ai/persons/batchGet',
      ],
    ]

    for (const [tool, params, method, url] of descriptors) {
      expect(
        typeof tool.request.method === 'function'
          ? tool.request.method(params)
          : tool.request.method
      ).toBe(method)
      expect(buildUrl(tool, params)).toBe(url)
    }
  })

  it('keeps every API key user-only and sends it only in the apikey header', () => {
    for (const tool of allTools) {
      expect(tool.params.apiKey).toMatchObject({ required: true, visibility: 'user-only' })
      const headers = tool.request.headers({ apiKey: 'team-secret' } as never)
      expect(headers.apikey).toBe('team-secret')
      expect(headers.Authorization).toBeUndefined()
    }

    const requestSamples: Array<[ToolConfig, Record<string, unknown>]> = [
      [harmonicSearchPeopleScoutTool, { apiKey: 'team-secret', query: 'find FDEs' }],
      [harmonicListPeopleSavedSearchesTool, { apiKey: 'team-secret' }],
      [
        harmonicGetPeopleSavedSearchResultsTool,
        { apiKey: 'team-secret', savedSearchId: 'urn:harmonic:saved_search:1' },
      ],
      [harmonicBatchGetPeopleTool, { apiKey: 'team-secret', personIds: [1] }],
    ]
    for (const [tool, params] of requestSamples) {
      expect(buildUrl(tool, params)).not.toContain('team-secret')
      if (tool.request.body)
        expect(JSON.stringify(buildBody(tool, params))).not.toContain('team-secret')
    }
  })

  it('uses the deterministic standard message extractor for Harmonic errors', () => {
    for (const tool of allTools) expect(tool.errorExtractor).toBe('standard-message')
    expect(
      extractErrorMessage(
        {
          status: 403,
          data: { message: 'Authentication required. Include either an api key or a JWT.' },
        },
        harmonicBatchGetPeopleTool.errorExtractor
      )
    ).toBe('Authentication required. Include either an api key or a JWT.')
  })

  it('does not expose the API key in local validation errors', () => {
    let validationError: unknown
    try {
      buildBody(harmonicBatchGetPeopleTool, { apiKey: 'team-secret' })
    } catch (error) {
      validationError = error
    }

    expect(validationError).toBeInstanceOf(Error)
    expect((validationError as Error).message).not.toContain('team-secret')
  })
})

describe('Harmonic Scout', () => {
  it('sends the exact fixed structured-output schema and projects only the natural-language query', () => {
    const body = buildBody(harmonicSearchPeopleScoutTool, {
      apiKey: 'secret',
      query: '  Find FDEs in enterprise software  ',
    })
    expect(buildUrl(harmonicSearchPeopleScoutTool, {})).toBe(
      'https://api.harmonic.ai/scout/tasks/wait'
    )
    expect(body).toEqual({
      input: 'Find FDEs in enterprise software',
      json_schema: HARMONIC_SCOUT_PEOPLE_SCHEMA,
    })
    expect(body).not.toHaveProperty('request_origin')
    expect(HARMONIC_SCOUT_PEOPLE_SCHEMA.required).toEqual(['people'])
    expect(HARMONIC_SCOUT_PEOPLE_SCHEMA.properties.people.items.required).toEqual(['name'])
    expect(Object.keys(HARMONIC_SCOUT_PEOPLE_SCHEMA.properties.people.items.properties)).toEqual([
      'name',
      'linkedin_url',
      'person_urn',
      'title',
      'company',
      'location',
      'email',
      'one_liner',
    ])

    const modelInput = harmonicSearchPeopleScoutTool.request.modelInput
    expect(modelInput?.mode).toBe('project')
    expect(
      modelInput?.mode === 'project' &&
        modelInput.select({ apiKey: 'secret', query: 'Find FDEs' } as never)
    ).toEqual({ query: 'Find FDEs' })
  })

  it('normalizes Scout people into the shared contacts table', async () => {
    const result = await harmonicSearchPeopleScoutTool.transformResponse!(
      jsonResponse({
        task_id: 'task-1',
        status: 'success',
        content: {
          people: [
            {
              name: 'Grace Hopper',
              linkedin_url: 'https://linkedin.com/in/grace',
              person_urn: 'urn:harmonic:person:456',
              title: 'Forward Deployed Engineer',
              company: 'Enterprise Co',
              location: 'New York, NY',
              email: 'grace@example.com',
              one_liner: 'Builds enterprise deployment systems.',
            },
          ],
        },
      })
    )

    expect(result.output).toMatchObject({ taskId: 'task-1', status: 'success', count: 1 })
    expectOutputParity(harmonicSearchPeopleScoutTool, result.output)
    expect(result.output.contacts[0]).toEqual({
      personUrn: 'urn:harmonic:person:456',
      personId: null,
      fullName: 'Grace Hopper',
      firstName: null,
      lastName: null,
      headline: 'Forward Deployed Engineer',
      currentTitles: ['Forward Deployed Engineer'],
      currentCompanyNames: ['Enterprise Co'],
      currentCompanyUrns: [],
      primaryEmail: 'grace@example.com',
      emails: ['grace@example.com'],
      phoneNumbers: [],
      linkedinUrl: 'https://linkedin.com/in/grace',
      formattedLocation: 'New York, NY',
      city: null,
      state: null,
      country: null,
      profilePictureUrl: null,
      summary: 'Builds enterprise deployment systems.',
      isRedacted: null,
    })
  })

  it.each(['error', 'timeout', 'interrupted', 'pending', 'running'])(
    'fails closed when /wait returns %s',
    async (status) => {
      await expect(
        harmonicSearchPeopleScoutTool.transformResponse!(
          jsonResponse({ task_id: 'task-2', status, content: 'Provider detail' })
        )
      ).rejects.toThrow(`status "${status}": Provider detail`)
    }
  )

  it('rejects malformed structured content and rows without the required name', async () => {
    await expect(
      harmonicSearchPeopleScoutTool.transformResponse!(
        jsonResponse({ task_id: 'task-3', status: 'success', content: 'not structured' })
      )
    ).rejects.toThrow(/invalid Scout content/)

    await expect(
      harmonicSearchPeopleScoutTool.transformResponse!(
        jsonResponse({ task_id: 'task-4', status: 'success', content: { people: [{}] } })
      )
    ).rejects.toThrow(/required name/)
  })
})

describe('Harmonic people retrieval', () => {
  it('filters saved searches to PERSONS and projects only stable metadata', async () => {
    const result = await harmonicListPeopleSavedSearchesTool.transformResponse!(
      jsonResponse([
        {
          id: 1,
          entity_urn: 'urn:harmonic:saved_search:1',
          name: 'FDE candidates',
          is_private: false,
          type: 'PERSONS',
          query: { query: 'not exposed downstream' },
          creator: 'urn:harmonic:user:1',
          user_saved_search_type: 'USER_CREATED',
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-02T00:00:00Z',
        },
        { id: 2, type: 'COMPANIES_LIST', name: 'Enterprise companies' },
      ])
    )

    expect(result.output.count).toBe(1)
    expectOutputParity(harmonicListPeopleSavedSearchesTool, result.output)
    expect(result.output.savedSearches[0]).toEqual({
      savedSearchId: 1,
      savedSearchUrn: 'urn:harmonic:saved_search:1',
      name: 'FDE candidates',
      isPrivate: false,
      savedSearchType: 'PERSONS',
      userSavedSearchType: 'USER_CREATED',
      creatorUrn: 'urn:harmonic:user:1',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-02T00:00:00Z',
    })
    expect(result.output.savedSearches[0]).not.toHaveProperty('query')
  })

  it('caps page size, preserves opaque cursors, and safely encodes path IDs', () => {
    const url = new URL(
      buildUrl(harmonicGetPeopleSavedSearchResultsTool, {
        savedSearchId: 'urn:harmonic:saved_search:with spaces',
        size: 1000,
        cursor: ' opaque/+ cursor ',
      })
    )
    expect(url.pathname).toBe(
      '/savedSearches:results/urn%3Aharmonic%3Asaved_search%3Awith%20spaces'
    )
    expect(url.searchParams.get('size')).toBe('100')
    expect(url.searchParams.get('cursor')).toBe(' opaque/+ cursor ')

    expect(
      new URL(
        buildUrl(harmonicGetPeopleSavedSearchResultsTool, { savedSearchId: '1', size: -3 })
      ).searchParams.get('size')
    ).toBe('1')
    expect(() =>
      buildUrl(harmonicGetPeopleSavedSearchResultsTool, { savedSearchId: '1', size: 3.5 })
    ).toThrow(/must be an integer/)
  })

  it('normalizes full profiles while preserving URN-only saved-search results', async () => {
    const result = await harmonicGetPeopleSavedSearchResultsTool.transformResponse!(
      jsonResponse({
        count: 3,
        page_info: { next: ' next-2 ', current: ' current-1 ', has_next: true },
        results: ['urn:harmonic:person:999', personFixture, 'urn:harmonic:person:999'],
      })
    )

    expect(result.output.personUrns).toEqual(['urn:harmonic:person:999', 'urn:harmonic:person:123'])
    expectOutputParity(harmonicGetPeopleSavedSearchResultsTool, result.output)
    expect(result.output.totalCount).toBe(3)
    expect(result.output.pageInfo).toEqual({
      nextCursor: ' next-2 ',
      currentCursor: ' current-1 ',
      hasNext: true,
    })
    expect(result.output.contacts).toHaveLength(1)
    expect(result.output.contacts[0]).toMatchObject({
      personUrn: 'urn:harmonic:person:123',
      personId: 123,
      fullName: 'Ada Lovelace',
      currentTitles: ['Forward Deployed Engineer', 'Advisor'],
      currentCompanyNames: ['Enterprise One', 'Enterprise Two'],
      currentCompanyUrns: ['urn:harmonic:company:1', 'urn:harmonic:company:2'],
      primaryEmail: 'ada@example.com',
      emails: ['ada@example.com', 'ada.personal@example.com', 'ada.exec@example.com'],
      phoneNumbers: ['+1 415 555 0100'],
      linkedinUrl: 'https://www.linkedin.com/in/ada',
      formattedLocation: 'San Francisco, California, United States',
      city: 'San Francisco',
      state: 'California',
      country: 'United States',
      profilePictureUrl: 'https://images.example.com/ada.jpg',
      summary: null,
      isRedacted: false,
    })
  })

  it('fails closed if a people saved search returns another entity type', async () => {
    await expect(
      harmonicGetPeopleSavedSearchResultsTool.transformResponse!(
        jsonResponse({ results: ['urn:harmonic:company:1'] })
      )
    ).rejects.toThrow(/person URNs/)

    await expect(
      harmonicGetPeopleSavedSearchResultsTool.transformResponse!(
        jsonResponse({ results: [{ entity_urn: 'urn:harmonic:investor:1' }] })
      )
    ).rejects.toThrow(/non-person result/)
  })

  it('accepts parsed or JSON-string batch identifiers and enforces the 500-person limit', () => {
    expect(
      buildBody(harmonicBatchGetPeopleTool, {
        personIds: '[1,"2",1]',
        personUrns: ['urn:harmonic:person:3'],
      })
    ).toEqual({ ids: [1, 2], urns: ['urn:harmonic:person:3'] })

    expect(() => buildBody(harmonicBatchGetPeopleTool, {})).toThrow(/at least one/)
    expect(() =>
      buildBody(harmonicBatchGetPeopleTool, {
        personIds: Array.from({ length: 501 }, (_, index) => index),
      })
    ).toThrow(/at most 500/)
    expect(() =>
      buildBody(harmonicBatchGetPeopleTool, { personUrns: ['urn:harmonic:company:1'] })
    ).toThrow(/person URNs/)
  })

  it('returns the shared contact shape from Batch Get People', async () => {
    const result = await harmonicBatchGetPeopleTool.transformResponse!(
      jsonResponse([
        personFixture,
        {
          entity_urn: 'urn:harmonic:person:redacted',
          id: '21e7055f-bb30-44c7-8a8f-4cd5f0d5c4ec',
          is_redacted: true,
        },
      ])
    )
    expect(result.output.count).toBe(2)
    expectOutputParity(harmonicBatchGetPeopleTool, result.output)
    expect(Object.keys(result.output.contacts[0])).toEqual(
      Object.keys(harmonicBatchGetPeopleTool.outputs!.contacts.items!.properties!)
    )
    expect(result.output.contacts[1]).toEqual({
      personUrn: 'urn:harmonic:person:redacted',
      personId: null,
      fullName: null,
      firstName: null,
      lastName: null,
      headline: null,
      currentTitles: [],
      currentCompanyNames: [],
      currentCompanyUrns: [],
      primaryEmail: null,
      emails: [],
      phoneNumbers: [],
      linkedinUrl: null,
      formattedLocation: null,
      city: null,
      state: null,
      country: null,
      profilePictureUrl: null,
      summary: null,
      isRedacted: true,
    })
  })
})
