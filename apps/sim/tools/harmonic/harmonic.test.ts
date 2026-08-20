/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { extractErrorMessage } from '@/tools/error-extractors'
import { harmonicBatchGetPeopleTool } from '@/tools/harmonic/batch_get_people'
import { harmonicGetPeopleSavedSearchResultsTool } from '@/tools/harmonic/get_people_saved_search_results'
import { harmonicListPeopleSavedSearchesTool } from '@/tools/harmonic/list_people_saved_searches'
import { harmonicSearchPeopleScoutTool } from '@/tools/harmonic/search_people_scout'
import {
  HARMONIC_PERSON_INCLUDE_FIELDS,
  HARMONIC_SCOUT_PEOPLE_SCHEMA,
} from '@/tools/harmonic/utils'
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

  it('uses the connected Harmonic credential only in the apikey header', () => {
    for (const tool of allTools) {
      expect(tool.oauth).toEqual({ required: true, provider: 'harmonic' })
      expect(tool.params.accessToken).toMatchObject({ required: true, visibility: 'hidden' })
      expect(tool.params).not.toHaveProperty('apiKey')
      const headers = tool.request.headers({ accessToken: 'team-secret' } as never)
      expect(headers.apikey).toBe('team-secret')
      expect(headers.Authorization).toBeUndefined()
    }

    const requestSamples: Array<[ToolConfig, Record<string, unknown>]> = [
      [harmonicSearchPeopleScoutTool, { accessToken: 'team-secret', query: 'find FDEs' }],
      [harmonicListPeopleSavedSearchesTool, { accessToken: 'team-secret' }],
      [
        harmonicGetPeopleSavedSearchResultsTool,
        { accessToken: 'team-secret', savedSearchId: 'urn:harmonic:saved_search:1' },
      ],
      [harmonicBatchGetPeopleTool, { accessToken: 'team-secret', personIds: [1] }],
    ]
    for (const [tool, params] of requestSamples) {
      expect(buildUrl(tool, params)).not.toContain('team-secret')
      if (tool.request.body)
        expect(JSON.stringify(buildBody(tool, params))).not.toContain('team-secret')
    }
  })

  it('extracts Harmonic message and FastAPI validation errors without echoed input', () => {
    for (const tool of allTools) expect(tool.errorExtractor).toBe('harmonic-errors')
    expect(
      extractErrorMessage(
        {
          status: 403,
          data: { message: 'Authentication required. Include either an api key or a JWT.' },
        },
        harmonicBatchGetPeopleTool.errorExtractor
      )
    ).toBe('Authentication required. Include either an api key or a JWT.')

    const validationMessage = extractErrorMessage(
      {
        status: 422,
        data: {
          detail: [
            {
              type: 'int_parsing',
              loc: ['body', 'ids', 0],
              msg: 'Input should be a valid integer',
              input: 'private-body-value',
            },
            {
              type: 'string_pattern_mismatch',
              loc: ['body', 'urns', 1],
              msg: 'String should match the person URN pattern',
              input: 'private-urn-value',
            },
          ],
        },
      },
      harmonicBatchGetPeopleTool.errorExtractor
    )
    expect(validationMessage).toBe(
      'ids.0: Input should be a valid integer; urns.1: String should match the person URN pattern'
    )
    expect(validationMessage).not.toContain('private-body-value')
    expect(validationMessage).not.toContain('private-urn-value')
  })

  it('does not expose the resolved credential in local validation errors', () => {
    let validationError: unknown
    try {
      buildBody(harmonicBatchGetPeopleTool, { accessToken: 'team-secret' })
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
      accessToken: 'secret',
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
        modelInput.select({ accessToken: 'secret', query: 'Find FDEs' } as never)
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
      currentCompanyUrns: null,
      primaryEmail: 'grace@example.com',
      emails: ['grace@example.com'],
      phoneNumbers: null,
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

  it('accepts only canonical HTTPS LinkedIn profile URLs and strips query fragments', async () => {
    const urls = [
      'https://www.linkedin.com/in/safe-person?trk=public_profile#about',
      'https://uk.linkedin.com/pub/legacy-person/1/2/3?tracking=1',
      'https://www.linkedin.com:443/in/default-port?tracking=1',
      'https://evil.example/linkedin.com/in/path-bypass',
      'https://linkedin.com.evil.example/in/suffix-bypass',
      'https://evil-linkedin.com/in/lookalike',
      'https://linkedin.com@evil.example/in/credentials-bypass',
      'https://user:password@www.linkedin.com/in/credentialed',
      'https://www.linkedin.com:8443/in/nondefault-port',
      'http://www.linkedin.com/in/insecure',
      'https://www.linkedin.com/company/not-a-person',
      'not a url',
    ]
    const result = await harmonicSearchPeopleScoutTool.transformResponse!(
      jsonResponse({
        task_id: 'task-linkedin',
        status: 'success',
        content: {
          people: urls.map((linkedin_url, index) => ({
            name: `Person ${index}`,
            linkedin_url,
          })),
        },
      })
    )

    expect(result.output.contacts.map((contact) => contact.linkedinUrl)).toEqual([
      'https://www.linkedin.com/in/safe-person',
      'https://uk.linkedin.com/pub/legacy-person/1/2/3',
      'https://www.linkedin.com/in/default-port',
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ])
    expect(result.output.contacts[0]).toMatchObject({
      currentTitles: null,
      currentCompanyNames: null,
      currentCompanyUrns: null,
      emails: null,
      phoneNumbers: null,
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

  const validPeopleSavedSearch = {
    id: 1,
    entity_urn: 'urn:harmonic:saved_search:1',
    name: 'People',
    type: 'PERSONS',
    creator: 'urn:harmonic:user:1',
    user_saved_search_type: 'USER_CREATED',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
  }

  it.each([
    ['id', '1'],
    ['entity_urn', 'urn:harmonic:company:1'],
    ['name', '   '],
    ['creator', 'urn:harmonic:company:1'],
    ['user_saved_search_type', 'UNKNOWN'],
    ['created_at', 'yesterday'],
    ['created_at', '2026-02-31T12:34:56Z'],
    ['created_at', '2026-01-01T00:00:60Z'],
    ['created_at', '2025-12-31T23:59:60Z'],
    ['created_at', '0072-06-30T23:59:60Z'],
    ['created_at', '0072-07-01T00:59:60+01:00'],
    ['updated_at', '2026-01-02'],
  ])('rejects a malformed required PERSONS saved-search %s', async (field, invalidValue) => {
    const row = { ...validPeopleSavedSearch, [field]: invalidValue }
    await expect(
      harmonicListPeopleSavedSearchesTool.transformResponse!(jsonResponse([row]))
    ).rejects.toThrow(/saved search/)
  })

  it.each([
    'id',
    'entity_urn',
    'name',
    'creator',
    'user_saved_search_type',
    'created_at',
    'updated_at',
  ])('rejects an omitted required PERSONS saved-search %s', async (field) => {
    const row: Record<string, unknown> = { ...validPeopleSavedSearch }
    delete row[field]
    await expect(
      harmonicListPeopleSavedSearchesTool.transformResponse!(jsonResponse([row]))
    ).rejects.toThrow(/saved search/)
  })

  it('accepts RFC 3339 lowercase separators and leap seconds', async () => {
    const result = await harmonicListPeopleSavedSearchesTool.transformResponse!(
      jsonResponse([
        {
          ...validPeopleSavedSearch,
          created_at: '2026-01-01t00:00:00z',
          updated_at: '2016-12-31T23:59:60Z',
        },
      ])
    )

    expect(result.output.savedSearches[0]).toMatchObject({
      createdAt: '2026-01-01t00:00:00z',
      updatedAt: '2016-12-31T23:59:60Z',
    })
  })

  it('accepts an actual leap second represented with a numeric offset', async () => {
    const result = await harmonicListPeopleSavedSearchesTool.transformResponse!(
      jsonResponse([
        {
          ...validPeopleSavedSearch,
          updated_at: '2017-01-01T00:59:60+01:00',
        },
      ])
    )

    expect(result.output.savedSearches[0].updatedAt).toBe('2017-01-01T00:59:60+01:00')
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
    ).toThrow(/safe decimal integer/)

    for (const size of [
      true,
      [5],
      ' ',
      '1e2',
      '0x10',
      Number.MAX_SAFE_INTEGER + 1,
      Number.POSITIVE_INFINITY,
    ]) {
      expect(() =>
        buildUrl(harmonicGetPeopleSavedSearchResultsTool, { savedSearchId: '1', size })
      ).toThrow(/safe decimal integer/)
    }
  })

  it('validates page_info strictly while preserving opaque cursor bytes', async () => {
    const result = await harmonicGetPeopleSavedSearchResultsTool.transformResponse!(
      jsonResponse({
        results: [],
        page_info: { next: '', current: ' opaque/+ cursor ', has_next: false },
      })
    )
    expect(result.output.pageInfo).toEqual({
      nextCursor: '',
      currentCursor: ' opaque/+ cursor ',
      hasNext: false,
    })

    for (const page_info of [
      'not-an-object',
      {},
      { has_next: 'false' },
      { has_next: true, next: 42 },
      { has_next: false, current: {} },
    ]) {
      await expect(
        harmonicGetPeopleSavedSearchResultsTool.transformResponse!(
          jsonResponse({ results: [], page_info })
        )
      ).rejects.toThrow(/page_info/)
    }

    const withoutPageInfo = await harmonicGetPeopleSavedSearchResultsTool.transformResponse!(
      jsonResponse({ results: [] })
    )
    expect(withoutPageInfo.output.pageInfo).toBeNull()
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

  it('never trusts social map keys and returns only a later safe LinkedIn profile URL', async () => {
    const result = await harmonicBatchGetPeopleTool.transformResponse!(
      jsonResponse([
        {
          ...personFixture,
          socials: {
            LINKEDIN: { url: 'https://evil.example/linkedin.com/in/phishing' },
            OTHER: {
              url: 'https://www.linkedin.com/in/ada-safe?trk=provider#experience',
            },
          },
        },
      ])
    )

    expect(result.output.contacts[0].linkedinUrl).toBe('https://www.linkedin.com/in/ada-safe')
  })

  it('falls back to the first current title when the LinkedIn headline is unavailable', async () => {
    const result = await harmonicBatchGetPeopleTool.transformResponse!(
      jsonResponse([{ ...personFixture, linkedin_headline: null }])
    )
    expect(result.output.contacts[0].headline).toBe('Forward Deployed Engineer')
  })

  it.each([undefined, 'not-a-uuid', 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects a full person with invalid required ID %s',
    async (id) => {
      const person = { entity_urn: 'urn:harmonic:person:invalid-id', id }

      await expect(
        harmonicBatchGetPeopleTool.transformResponse!(jsonResponse([person]))
      ).rejects.toThrow(/invalid ID/)
      await expect(
        harmonicGetPeopleSavedSearchResultsTool.transformResponse!(
          jsonResponse({ results: [person] })
        )
      ).rejects.toThrow(/invalid ID/)
    }
  )

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
    const body = buildBody(harmonicBatchGetPeopleTool, {
      personIds: '[1,"2",1]',
      personUrns: ['urn:harmonic:person:3'],
    })
    expect(body).toEqual({
      ids: [1, 2],
      urns: ['urn:harmonic:person:3'],
      include_fields: HARMONIC_PERSON_INCLUDE_FIELDS,
    })

    expect(() => buildBody(harmonicBatchGetPeopleTool, {})).toThrow(/at least one/)
    expect(() =>
      buildBody(harmonicBatchGetPeopleTool, {
        personIds: Array.from({ length: 501 }, (_, index) => index),
      })
    ).toThrow(/at most 500/)
    expect(() =>
      buildBody(harmonicBatchGetPeopleTool, {
        personIds: Array.from({ length: 501 }, () => 1),
      })
    ).toThrow(/at most 500/)
    expect(() =>
      buildBody(harmonicBatchGetPeopleTool, { personUrns: ['urn:harmonic:company:1'] })
    ).toThrow(/person URNs/)

    for (const id of [
      true,
      [5],
      ' ',
      '1e2',
      '0x10',
      1.5,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      expect(() => buildBody(harmonicBatchGetPeopleTool, { personIds: [id] })).toThrow(
        /safe decimal integer/
      )
    }
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
    for (const field of [
      'currentTitles',
      'currentCompanyNames',
      'currentCompanyUrns',
      'emails',
      'phoneNumbers',
    ]) {
      expect(harmonicBatchGetPeopleTool.outputs!.contacts.items!.properties?.[field].nullable).toBe(
        true
      )
    }
    expect(result.output.contacts[1]).toEqual({
      personUrn: 'urn:harmonic:person:redacted',
      personId: null,
      fullName: null,
      firstName: null,
      lastName: null,
      headline: null,
      currentTitles: null,
      currentCompanyNames: null,
      currentCompanyUrns: null,
      primaryEmail: null,
      emails: null,
      phoneNumbers: null,
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
