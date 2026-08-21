/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { extractErrorMessage } from '@/tools/error-extractors'
import { harmonicBatchGetPeopleTool } from '@/tools/harmonic/batch_get_people'
import { harmonicClearPeopleSavedSearchNetNewResultsTool } from '@/tools/harmonic/clear_people_saved_search_net_new_results'
import { harmonicEnrichPersonTool } from '@/tools/harmonic/enrich_person'
import { harmonicGetCompanyEmployeesTool } from '@/tools/harmonic/get_company_employees'
import { harmonicGetEmailEnrichmentJobTool } from '@/tools/harmonic/get_email_enrichment_job'
import { harmonicGetEmailEnrichmentUsageTool } from '@/tools/harmonic/get_email_enrichment_usage'
import { harmonicGetEnrichmentStatusTool } from '@/tools/harmonic/get_enrichment_status'
import { harmonicGetPeopleSavedSearchNetNewResultsTool } from '@/tools/harmonic/get_people_saved_search_net_new_results'
import { harmonicGetPeopleSavedSearchResultsTool } from '@/tools/harmonic/get_people_saved_search_results'
import { harmonicGetPersonTool } from '@/tools/harmonic/get_person'
import { harmonicListPeopleSavedSearchesTool } from '@/tools/harmonic/list_people_saved_searches'
import { harmonicSearchPeopleScoutTool } from '@/tools/harmonic/search_people_scout'
import { harmonicSubmitEmailEnrichmentJobTool } from '@/tools/harmonic/submit_email_enrichment_job'
import {
  HARMONIC_PERSON_INCLUDE_FIELDS,
  HARMONIC_SCOUT_PEOPLE_SCHEMA,
} from '@/tools/harmonic/utils'
import type { ToolConfig } from '@/tools/types'

const allTools = [
  harmonicSearchPeopleScoutTool,
  harmonicEnrichPersonTool,
  harmonicGetPersonTool,
  harmonicBatchGetPeopleTool,
  harmonicGetCompanyEmployeesTool,
  harmonicListPeopleSavedSearchesTool,
  harmonicGetPeopleSavedSearchResultsTool,
  harmonicGetPeopleSavedSearchNetNewResultsTool,
  harmonicClearPeopleSavedSearchNetNewResultsTool,
  harmonicSubmitEmailEnrichmentJobTool,
  harmonicGetEmailEnrichmentJobTool,
  harmonicGetEmailEnrichmentUsageTool,
  harmonicGetEnrichmentStatusTool,
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

/** Harmonic answers job submission with 202; the executor still runs transformResponse. */
const accepted202Response = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 202,
    headers: { 'Content-Type': 'application/json' },
  })

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
  it('exports exactly the supported snake_case tool IDs', () => {
    expect(allTools.map((tool) => tool.id)).toEqual([
      'harmonic_search_people_scout',
      'harmonic_enrich_person',
      'harmonic_get_person',
      'harmonic_batch_get_people',
      'harmonic_get_company_employees',
      'harmonic_list_people_saved_searches',
      'harmonic_get_people_saved_search_results',
      'harmonic_get_people_saved_search_net_new_results',
      'harmonic_clear_people_saved_search_net_new_results',
      'harmonic_submit_email_enrichment_job',
      'harmonic_get_email_enrichment_job',
      'harmonic_get_email_enrichment_usage',
      'harmonic_get_enrichment_status',
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
      [
        harmonicEnrichPersonTool,
        { linkedinUrl: 'https://www.linkedin.com/in/ada' },
        'POST',
        'https://api.harmonic.ai/persons?linkedin_url=https%3A%2F%2Fwww.linkedin.com%2Fin%2Fada',
      ],
      [
        harmonicGetPersonTool,
        { personId: 'urn:harmonic:person:123' },
        'GET',
        'https://api.harmonic.ai/persons/urn%3Aharmonic%3Aperson%3A123',
      ],
      [
        harmonicGetCompanyEmployeesTool,
        { companyId: '1' },
        'GET',
        'https://api.harmonic.ai/companies/1/employees?size=50',
      ],
      [
        harmonicGetPeopleSavedSearchNetNewResultsTool,
        { savedSearchId: 'search-1' },
        'GET',
        'https://api.harmonic.ai/savedSearches/search-1/net_new_results?size=50',
      ],
      [
        harmonicClearPeopleSavedSearchNetNewResultsTool,
        { savedSearchId: 'search-1', clearScope: 'all' },
        'POST',
        'https://api.harmonic.ai/savedSearches/search-1/clear_net_new_results',
      ],
      [
        harmonicSubmitEmailEnrichmentJobTool,
        { personUrns: ['urn:harmonic:person:1'] },
        'POST',
        'https://api.harmonic.ai/email_enrichment/jobs',
      ],
      [
        harmonicGetEmailEnrichmentJobTool,
        { jobId: 'job-1' },
        'GET',
        'https://api.harmonic.ai/email_enrichment/jobs/job-1',
      ],
      [
        harmonicGetEmailEnrichmentUsageTool,
        {},
        'GET',
        'https://api.harmonic.ai/email_enrichment/usage',
      ],
      [
        harmonicGetEnrichmentStatusTool,
        { enrichmentUrns: ['urn:harmonic:enrichment:1'] },
        'GET',
        'https://api.harmonic.ai/enrichment_status?urns=urn%3Aharmonic%3Aenrichment%3A1',
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

    /** One sample per registered tool: every URL builder interpolates user input. */
    const requestSamples: Array<[ToolConfig, Record<string, unknown>]> = [
      [harmonicSearchPeopleScoutTool, { accessToken: 'team-secret', query: 'find FDEs' }],
      [harmonicListPeopleSavedSearchesTool, { accessToken: 'team-secret' }],
      [
        harmonicGetPeopleSavedSearchResultsTool,
        { accessToken: 'team-secret', savedSearchId: 'urn:harmonic:saved_search:1' },
      ],
      [harmonicBatchGetPeopleTool, { accessToken: 'team-secret', personIds: [1] }],
      [
        harmonicEnrichPersonTool,
        { accessToken: 'team-secret', linkedinUrl: 'https://www.linkedin.com/in/ada' },
      ],
      [harmonicGetPersonTool, { accessToken: 'team-secret', personId: '123' }],
      [harmonicGetCompanyEmployeesTool, { accessToken: 'team-secret', companyId: '1' }],
      [
        harmonicGetPeopleSavedSearchNetNewResultsTool,
        { accessToken: 'team-secret', savedSearchId: '5' },
      ],
      [
        harmonicClearPeopleSavedSearchNetNewResultsTool,
        { accessToken: 'team-secret', savedSearchId: '5', clearScope: 'all' },
      ],
      [
        harmonicSubmitEmailEnrichmentJobTool,
        { accessToken: 'team-secret', personUrns: ['urn:harmonic:person:1'] },
      ],
      [harmonicGetEmailEnrichmentJobTool, { accessToken: 'team-secret', jobId: 'job-1' }],
      [harmonicGetEmailEnrichmentUsageTool, { accessToken: 'team-secret' }],
      [
        harmonicGetEnrichmentStatusTool,
        { accessToken: 'team-secret', enrichmentUrns: ['urn:harmonic:enrichment:1'] },
      ],
    ]
    expect(requestSamples).toHaveLength(allTools.length)
    expect(new Set(requestSamples.map(([tool]) => tool.id))).toEqual(
      new Set(allTools.map((tool) => tool.id))
    )
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

  it('surfaces FastAPI string detail aborts instead of a bare status message', () => {
    for (const [status, detail] of [
      [403, 'Do not have enough permissions to access the resource'],
      [404, 'Saved search not found'],
    ] as const) {
      expect(
        extractErrorMessage({ status, data: { detail } }, harmonicBatchGetPeopleTool.errorExtractor)
      ).toBe(detail)
    }

    expect(
      extractErrorMessage(
        { status: 400, data: { detail: '   ' } },
        harmonicBatchGetPeopleTool.errorExtractor
      )
    ).toBe('Request failed with status 400')
  })

  it('keeps the scheduled enrichment URN out of the 404 envelope and in the message', () => {
    expect(
      extractErrorMessage(
        {
          status: 404,
          data: {
            detail: {
              message:
                'Person not found; scheduled for enrichment, check back in a few hours. Use /enrichment_status endpoint to get status of the enrichment.',
              enrichment_urn: 'urn:harmonic:enrichment:abc',
            },
          },
        },
        harmonicEnrichPersonTool.errorExtractor
      )
    ).toBe(
      'Person not found; scheduled for enrichment, check back in a few hours. Use /enrichment_status endpoint to get status of the enrichment. (urn:harmonic:enrichment:abc)'
    )

    expect(
      extractErrorMessage(
        { status: 404, data: { detail: { message: 'Person not found' } } },
        harmonicEnrichPersonTool.errorExtractor
      )
    ).toBe('Person not found')

    expect(
      extractErrorMessage(
        { status: 404, data: { detail: { enrichment_urn: 'urn:harmonic:enrichment:abc' } } },
        harmonicEnrichPersonTool.errorExtractor
      )
    ).toBe('urn:harmonic:enrichment:abc')

    expect(
      extractErrorMessage(
        { status: 404, data: { detail: {} } },
        harmonicEnrichPersonTool.errorExtractor
      )
    ).toBe('Request failed with status 404')
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

  it('passes an unrecognized user_saved_search_type through instead of failing the list', async () => {
    const result = await harmonicListPeopleSavedSearchesTool.transformResponse!(
      jsonResponse([{ ...validPeopleSavedSearch, user_saved_search_type: 'SOMETHING_NEW' }])
    )
    expect(result.output.savedSearches).toHaveLength(1)
    expect(result.output.savedSearches[0].userSavedSearchType).toBe('SOMETHING_NEW')
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

describe('Harmonic person enrichment', () => {
  it('requires a LinkedIn URL or an email and sends both when supplied', () => {
    expect(() => buildUrl(harmonicEnrichPersonTool, {})).toThrow(
      'requires a LinkedIn profile URL or an email address'
    )
    expect(
      buildUrl(harmonicEnrichPersonTool, {
        linkedinUrl: 'https://www.linkedin.com/in/ada',
        email: 'ada@example.com',
      })
    ).toBe(
      'https://api.harmonic.ai/persons?linkedin_url=https%3A%2F%2Fwww.linkedin.com%2Fin%2Fada&email=ada%40example.com'
    )
  })

  it('projects an enriched person and flags a queued background refresh', async () => {
    const enriched = await harmonicEnrichPersonTool.transformResponse!(
      new Response(
        JSON.stringify({
          ...personFixture,
          enrichment_urn: 'urn:harmonic:enrichment:9',
          merged_person_urn: 'urn:harmonic:person:456',
          requested_entity_urn: 'urn:harmonic:person:123',
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } }
      ),
      {}
    )

    expect(enriched.output.found).toBe(true)
    expect(enriched.output.contact?.fullName).toBe('Ada Lovelace')
    expect(enriched.output.enrichmentUrn).toBe('urn:harmonic:enrichment:9')
    expect(enriched.output.mergedPersonUrn).toBe('urn:harmonic:person:456')
    expect(enriched.output.enrichmentQueued).toBe(true)
    expectOutputParity(harmonicEnrichPersonTool, enriched.output)
  })

  it('reports a null body as not found rather than throwing', async () => {
    for (const tool of [harmonicEnrichPersonTool, harmonicGetPersonTool]) {
      const result = await tool.transformResponse!(jsonResponse(null), {})
      expect(result.output.found).toBe(false)
      expect(result.output.contact).toBeNull()
    }
  })

  it('rejects company context URNs from another entity family', () => {
    expect(() =>
      buildUrl(harmonicGetPersonTool, {
        personId: '123',
        companyContextUrns: ['urn:harmonic:person:1'],
      })
    ).toThrow('"companyContextUrns" must contain only company URNs')
  })

  it('repeats company context URNs as query parameters', () => {
    expect(
      buildUrl(harmonicGetPersonTool, {
        personId: '123',
        companyContextUrns: '["urn:harmonic:company:1","urn:harmonic:company:1"]',
      })
    ).toBe('https://api.harmonic.ai/persons/123?company_context_urns=urn%3Aharmonic%3Acompany%3A1')
  })
})

describe('Harmonic company employees', () => {
  it('validates enum filters, clamps size, and preserves opaque cursors', () => {
    expect(
      buildUrl(harmonicGetCompanyEmployeesTool, {
        companyId: 'urn:harmonic:company:1',
        employeeGroupType: 'founders',
        employeeStatus: 'ACTIVE_AND_NOT_ACTIVE',
        userConnectionStatus: 'TEAM_CONNECTION',
        size: 5000,
        cursor: 'Wzc1MjAwXQ==',
      })
    ).toBe(
      'https://api.harmonic.ai/companies/urn%3Aharmonic%3Acompany%3A1/employees?size=100&employee_group_type=FOUNDERS&employee_status=ACTIVE_AND_NOT_ACTIVE&user_connection_status=TEAM_CONNECTION&cursor=Wzc1MjAwXQ%3D%3D'
    )
    expect(() =>
      buildUrl(harmonicGetCompanyEmployeesTool, { companyId: '1', employeeGroupType: 'INTERNS' })
    ).toThrow('"employeeGroupType" must be one of')
  })

  it('returns person URNs only, deduplicated, with pagination metadata', async () => {
    const result = await harmonicGetCompanyEmployeesTool.transformResponse!(
      jsonResponse({
        count: 2,
        page_info: { next: 'next-cursor', current: null, has_next: true },
        results: ['urn:harmonic:person:1', 'urn:harmonic:person:1', 'urn:harmonic:person:2'],
      }),
      {}
    )

    expect(result.output.personUrns).toEqual(['urn:harmonic:person:1', 'urn:harmonic:person:2'])
    expect(result.output.totalCount).toBe(2)
    expect(result.output.pageInfo).toEqual({
      nextCursor: 'next-cursor',
      currentCursor: null,
      hasNext: true,
    })
    expectOutputParity(harmonicGetCompanyEmployeesTool, result.output)
  })

  it('fails closed when Harmonic returns a non-person URN', async () => {
    await expect(
      harmonicGetCompanyEmployeesTool.transformResponse!(
        jsonResponse({ results: ['urn:harmonic:company:9'] }),
        {}
      )
    ).rejects.toThrow('must contain only person URNs')
  })
})

describe('Harmonic saved-search net-new results', () => {
  it('reads the urns collection rather than results, and validates the since filter', async () => {
    const result = await harmonicGetPeopleSavedSearchNetNewResultsTool.transformResponse!(
      jsonResponse({
        urns: [personFixture, 'urn:harmonic:person:777'],
        cursor: 'echoed-cursor',
        page_info: { next: null, current: 'now', has_next: false },
      }),
      {}
    )

    expect(result.output.contacts).toHaveLength(1)
    expect(result.output.personUrns).toEqual(['urn:harmonic:person:123', 'urn:harmonic:person:777'])
    expect(result.output.cursor).toBe('echoed-cursor')
    expectOutputParity(harmonicGetPeopleSavedSearchNetNewResultsTool, result.output)

    expect(
      buildUrl(harmonicGetPeopleSavedSearchNetNewResultsTool, {
        savedSearchId: '5',
        newResultsSince: '2026-01-31',
      })
    ).toContain('new_results_since=2026-01-31')
    expect(() =>
      buildUrl(harmonicGetPeopleSavedSearchNetNewResultsTool, {
        savedSearchId: '5',
        newResultsSince: 'last tuesday',
      })
    ).toThrow('"newResultsSince" must be YYYY-MM-DD')
  })

  it('acknowledges specific URNs as repeated query parameters and echoes them back', async () => {
    const params = { savedSearchId: '5', personUrns: ['urn:harmonic:person:1'] }
    expect(buildUrl(harmonicClearPeopleSavedSearchNetNewResultsTool, params)).toBe(
      'https://api.harmonic.ai/savedSearches/5/clear_net_new_results?entity_urns=urn%3Aharmonic%3Aperson%3A1'
    )

    const cleared = await harmonicClearPeopleSavedSearchNetNewResultsTool.transformResponse!(
      jsonResponse({}),
      params
    )
    expect(cleared.output).toEqual({
      cleared: true,
      clearedPersonUrns: ['urn:harmonic:person:1'],
    })
  })

  it('never clears the whole backlog without an explicit scope', () => {
    for (const params of [
      { savedSearchId: '5' },
      { savedSearchId: '5', personUrns: [] },
      { savedSearchId: '5', personUrns: '[]' },
      { savedSearchId: '5', personUrns: '', clearScope: 'selected' },
    ]) {
      expect(() => buildUrl(harmonicClearPeopleSavedSearchNetNewResultsTool, params)).toThrow(
        'requires at least one person URN'
      )
    }

    expect(() =>
      buildUrl(harmonicClearPeopleSavedSearchNetNewResultsTool, {
        savedSearchId: '5',
        personUrns: ['urn:harmonic:person:1'],
        clearScope: 'all',
      })
    ).toThrow('cannot combine specific person URNs with clearing everything')

    expect(() =>
      buildUrl(harmonicClearPeopleSavedSearchNetNewResultsTool, {
        savedSearchId: '5',
        clearScope: 'everything',
      })
    ).toThrow('"clearScope" must be either')
  })

  it('clears every net-new result only when the scope says so', async () => {
    const params = { savedSearchId: '5', clearScope: 'all' }
    expect(buildUrl(harmonicClearPeopleSavedSearchNetNewResultsTool, params)).toBe(
      'https://api.harmonic.ai/savedSearches/5/clear_net_new_results'
    )
    const clearedAll = await harmonicClearPeopleSavedSearchNetNewResultsTool.transformResponse!(
      jsonResponse({}),
      params
    )
    expect(clearedAll.output.clearedPersonUrns).toBeNull()
  })
})

describe('Harmonic email enrichment', () => {
  it('rejects mixing identifier kinds and enforces the documented ceiling', () => {
    expect(() => buildBody(harmonicSubmitEmailEnrichmentJobTool, {})).toThrow(
      'requires at least one person URN or LinkedIn profile URL'
    )
    expect(() =>
      buildBody(harmonicSubmitEmailEnrichmentJobTool, {
        personUrns: ['urn:harmonic:person:1'],
        personLinkedinUrls: ['https://www.linkedin.com/in/ada'],
      })
    ).toThrow('accepts person URNs or LinkedIn URLs, not both')
    expect(() =>
      buildBody(harmonicSubmitEmailEnrichmentJobTool, {
        personUrns: Array.from({ length: 5001 }, (_, index) => `urn:harmonic:person:${index}`),
      })
    ).toThrow('at most 5000 people')
    expect(() =>
      buildBody(harmonicSubmitEmailEnrichmentJobTool, {
        personLinkedinUrls: ['not-a-url'],
      })
    ).toThrow('must contain absolute http(s) URLs')
  })

  it('folds every spelling of one profile into a single submitted entry', () => {
    expect(
      buildBody(harmonicSubmitEmailEnrichmentJobTool, {
        personLinkedinUrls: [
          'https://www.linkedin.com/in/ada?utm_source=x',
          'https://www.linkedin.com/in/ada',
          'https://www.linkedin.com/in/ada#about',
          'https://www.linkedin.com/in/ada/',
          'https://linkedin.com/in/ada',
          'https://WWW.LinkedIn.com/in/ada',
        ],
      })
    ).toEqual({ person_linkedin_urls: ['https://www.linkedin.com/in/ada'] })
  })

  it('keeps pass-through URLs distinct on every component Harmonic still sees', () => {
    expect(
      buildBody(harmonicSubmitEmailEnrichmentJobTool, {
        personLinkedinUrls: [
          'https://profiles.example/p?id=1',
          'https://profiles.example/p?id=2',
          'https://profiles.example:8443/p',
          'https://profiles.example/p#a',
          'https://profiles.example/p#b',
        ],
      })
    ).toEqual({
      person_linkedin_urls: [
        'https://profiles.example/p?id=1',
        'https://profiles.example/p?id=2',
        'https://profiles.example:8443/p',
        'https://profiles.example/p#a',
        'https://profiles.example/p#b',
      ],
    })

    expect(
      buildBody(harmonicSubmitEmailEnrichmentJobTool, {
        personLinkedinUrls: ['https://profiles.example/p?id=1', 'https://profiles.example/p?id=1'],
      })
    ).toEqual({ person_linkedin_urls: ['https://profiles.example/p?id=1'] })
  })

  it('keeps regional subdomains distinct rather than assuming an undocumented equivalence', () => {
    expect(
      buildBody(harmonicSubmitEmailEnrichmentJobTool, {
        personLinkedinUrls: ['https://uk.linkedin.com/in/ada', 'https://www.linkedin.com/in/ada'],
      })
    ).toEqual({
      person_linkedin_urls: ['https://uk.linkedin.com/in/ada', 'https://www.linkedin.com/in/ada'],
    })
  })

  it('treats blank LinkedIn entries as absent instead of a conflicting identifier list', () => {
    expect(
      buildBody(harmonicSubmitEmailEnrichmentJobTool, {
        personUrns: ['urn:harmonic:person:1'],
        personLinkedinUrls: ['', '   ', null],
      })
    ).toEqual({ person_urns: ['urn:harmonic:person:1'] })

    expect(() =>
      buildBody(harmonicSubmitEmailEnrichmentJobTool, { personLinkedinUrls: ['', '  '] })
    ).toThrow('requires at least one person URN or LinkedIn profile URL')
  })

  it('reports the identifier conflict before complaining about any single URL', () => {
    expect(() =>
      buildBody(harmonicSubmitEmailEnrichmentJobTool, {
        personUrns: ['urn:harmonic:person:1'],
        personLinkedinUrls: ['not-a-url'],
      })
    ).toThrow('accepts person URNs or LinkedIn URLs, not both')
  })

  it('surfaces the bulk email error codes with their quota counters', () => {
    expect(
      extractErrorMessage(
        {
          status: 429,
          data: {
            error: 'MONTHLY_QUOTA_INSUFFICIENT',
            needed: 500,
            available: 20,
            submitted: 500,
          },
        },
        harmonicSubmitEmailEnrichmentJobTool.errorExtractor
      )
    ).toBe('MONTHLY_QUOTA_INSUFFICIENT (needed 500, available 20, submitted 500)')

    expect(
      extractErrorMessage(
        { status: 422, data: { error: 'NO_ELIGIBLE_PEOPLE', submitted: 3, dropped: [] } },
        harmonicSubmitEmailEnrichmentJobTool.errorExtractor
      )
    ).toBe('NO_ELIGIBLE_PEOPLE (submitted 3)')

    /**
     * `extractErrorMessage` with no id walks every extractor in order, so a bare
     * `error` key here would hijack other providers' envelopes.
     */
    expect(
      extractErrorMessage({
        status: 400,
        data: { error: 'invalid_grant', error_description: 'The grant is invalid' },
      })
    ).toBe('The grant is invalid')
  })

  it('forwards unrecognised profile URLs so Harmonic can drop them per item', () => {
    expect(
      buildBody(harmonicSubmitEmailEnrichmentJobTool, {
        personLinkedinUrls: [
          'https://www.linkedin.com/in/ada?trk=nav',
          'https://linkedin.com.evil.example/in/ada',
        ],
      })
    ).toEqual({
      person_linkedin_urls: [
        'https://www.linkedin.com/in/ada',
        'https://linkedin.com.evil.example/in/ada',
      ],
    })
  })

  it('sends exactly one identifier array', () => {
    expect(
      buildBody(harmonicSubmitEmailEnrichmentJobTool, {
        personUrns: '["urn:harmonic:person:1","urn:harmonic:person:1"]',
      })
    ).toEqual({ person_urns: ['urn:harmonic:person:1'] })
    expect(
      buildBody(harmonicSubmitEmailEnrichmentJobTool, {
        personLinkedinUrls: ['https://www.linkedin.com/in/ada?trk=nav'],
      })
    ).toEqual({ person_linkedin_urls: ['https://www.linkedin.com/in/ada'] })
  })

  it("projects the submitted job from Harmonic's documented 202 with its dropped identifiers", async () => {
    const submitted = await harmonicSubmitEmailEnrichmentJobTool.transformResponse!(
      accepted202Response({
        job_id: 'job-1',
        status: 'PENDING',
        accepted_count: 2,
        monthly_remaining: 98,
        created_at: '2026-08-20T00:00:00Z',
        dropped: [{ submitted_identifier: 'urn:harmonic:person:9', reason: 'ALREADY_HAS_EMAIL' }],
      }),
      {}
    )

    expect(submitted.output.jobId).toBe('job-1')
    expect(submitted.output.dropped).toEqual([
      { submittedIdentifier: 'urn:harmonic:person:9', reason: 'ALREADY_HAS_EMAIL' },
    ])
    expectOutputParity(harmonicSubmitEmailEnrichmentJobTool, submitted.output)
  })

  it('keeps results null until the job is terminal and surfaces succeeded URNs after', async () => {
    const counts = {
      total_processed: 2,
      total_succeeded: 1,
      total_failed: 0,
      total_skipped: 0,
      total_not_found: 1,
    }

    const running = await harmonicGetEmailEnrichmentJobTool.transformResponse!(
      jsonResponse({
        job_id: 'job-1',
        status: 'IN_PROGRESS',
        counts,
        results: null,
        created_at: '2026-08-20T00:00:00Z',
      }),
      {}
    )
    expect(running.output.isTerminal).toBe(false)
    expect(running.output.results).toBeNull()
    expect(running.output.succeededPersonUrns).toEqual([])

    const done = await harmonicGetEmailEnrichmentJobTool.transformResponse!(
      jsonResponse({
        job_id: 'job-1',
        status: 'COMPLETED',
        counts,
        results: [
          { person_urn: 'urn:harmonic:person:1', status: 'SUCCESS' },
          { person_urn: 'urn:harmonic:person:2', status: 'NOT_FOUND' },
        ],
        created_at: '2026-08-20T00:00:00Z',
        completed_at: '2026-08-20T00:05:00Z',
      }),
      {}
    )
    expect(done.output.isTerminal).toBe(true)
    expect(done.output.succeededPersonUrns).toEqual(['urn:harmonic:person:1'])
    expect(done.output.counts.totalNotFound).toBe(1)
    expectOutputParity(harmonicGetEmailEnrichmentJobTool, done.output)
  })

  it('reads the monthly quota counters', async () => {
    const usage = await harmonicGetEmailEnrichmentUsageTool.transformResponse!(
      jsonResponse({ monthly_usage: 10, monthly_limit: 100, monthly_remaining: 90 }),
      {}
    )
    expect(usage.output).toEqual({ monthlyUsage: 10, monthlyLimit: 100, monthlyRemaining: 90 })

    await expect(
      harmonicGetEmailEnrichmentUsageTool.transformResponse!(
        jsonResponse({ monthly_usage: 10, monthly_limit: null, monthly_remaining: 90 }),
        {}
      )
    ).rejects.toThrow('without usable counters')
  })
})

describe('Harmonic enrichment status', () => {
  it('requires enrichment URNs and rejects other URN families', () => {
    expect(() => buildUrl(harmonicGetEnrichmentStatusTool, {})).toThrow(
      'requires at least one enrichment URN'
    )
    expect(() =>
      buildUrl(harmonicGetEnrichmentStatusTool, { enrichmentUrns: ['urn:harmonic:person:1'] })
    ).toThrow('must contain enrichment URNs or bare enrichment UUIDs')
  })

  it('routes bare UUIDs to ids and full URNs to urns, as Harmonic documents both', () => {
    expect(
      buildUrl(harmonicGetEnrichmentStatusTool, {
        enrichmentUrns: [
          '242437b6-eb4d-476b-b348-3c1bcc2d7069',
          'urn:harmonic:enrichment:242437b6-eb4d-476b-b348-3c1bcc2d7069',
        ],
      })
    ).toBe(
      'https://api.harmonic.ai/enrichment_status?ids=242437b6-eb4d-476b-b348-3c1bcc2d7069&urns=urn%3Aharmonic%3Aenrichment%3A242437b6-eb4d-476b-b348-3c1bcc2d7069'
    )
  })

  it('projects each enrichment status and validates the resolved entity URN', async () => {
    const result = await harmonicGetEnrichmentStatusTool.transformResponse!(
      jsonResponse([
        {
          entity_urn: 'urn:harmonic:enrichment:1',
          status: 'COMPLETE',
          message: null,
          enriched_entity_urn: 'urn:harmonic:person:123',
        },
      ]),
      {}
    )
    expect(result.output.count).toBe(1)
    expect(result.output.enrichments[0]).toEqual({
      enrichmentUrn: 'urn:harmonic:enrichment:1',
      status: 'COMPLETE',
      message: null,
      enrichedEntityUrn: 'urn:harmonic:person:123',
    })
    expectOutputParity(harmonicGetEnrichmentStatusTool, result.output)

    await expect(
      harmonicGetEnrichmentStatusTool.transformResponse!(
        jsonResponse([{ entity_urn: 'urn:harmonic:enrichment:1', enriched_entity_urn: 'nope' }]),
        {}
      )
    ).rejects.toThrow('invalid entity URN')
  })
})
