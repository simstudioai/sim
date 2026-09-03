import { describe, expect, it } from 'vitest'
import { OracleB2CServiceBlock } from '@/blocks/blocks/oracle-b2c-service'
import * as oracleTools from '@/tools/oracle_b2c_service'
import { ORACLE_B2C_SERVICE_LIST_FIELDS } from '@/tools/oracle_b2c_service/constants'
import {
  buildCollectionUrl,
  buildOracleHeaders,
  mapAnswer,
  mapContact,
  mapIncident,
  mapOrganization,
  normalizeSiteUrl,
  readOracleId,
  toSafeOracleNumberId,
} from '@/tools/oracle_b2c_service/utils'
import type { ToolConfig, ToolResponse } from '@/tools/types'

const auth = {
  siteUrl: 'https://example.custhelp.com',
  username: 'agent',
  password: 'secret',
  applicationContext: 'Sim Tests',
}

const tools = Object.values(oracleTools) as unknown as ToolConfig<
  Record<string, unknown>,
  ToolResponse
>[]
const toolsById = Object.fromEntries(tools.map((tool) => [tool.id, tool]))

function requestUrl(tool: ToolConfig, params: Record<string, unknown>): string {
  const url = tool.request.url
  return typeof url === 'function' ? url(params) : url
}

function requestBody(tool: ToolConfig, params: Record<string, unknown>): Record<string, unknown> {
  return tool.request.body?.(params) as Record<string, unknown>
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const operationCases = [
  [
    'oracle_b2c_service_list_incidents',
    'GET',
    `/services/rest/connect/v1.4/incidents?fields=${encodeURIComponent(ORACLE_B2C_SERVICE_LIST_FIELDS.incidents)}&limit=100`,
  ],
  ['oracle_b2c_service_get_incident', 'GET', '/services/rest/connect/v1.4/incidents/42'],
  ['oracle_b2c_service_create_incident', 'POST', '/services/rest/connect/v1.4/incidents'],
  ['oracle_b2c_service_update_incident', 'PATCH', '/services/rest/connect/v1.4/incidents/42'],
  ['oracle_b2c_service_delete_incident', 'DELETE', '/services/rest/connect/v1.4/incidents/42'],
  [
    'oracle_b2c_service_create_incident_response',
    'POST',
    '/services/rest/connect/v1.4/incidentResponse',
  ],
  [
    'oracle_b2c_service_list_contacts',
    'GET',
    `/services/rest/connect/v1.4/contacts?fields=${encodeURIComponent(ORACLE_B2C_SERVICE_LIST_FIELDS.contacts)}&limit=100`,
  ],
  [
    'oracle_b2c_service_get_contact',
    'GET',
    '/services/rest/connect/v1.4/contacts/42?expand=emails%2Cphones',
  ],
  ['oracle_b2c_service_create_contact', 'POST', '/services/rest/connect/v1.4/contacts'],
  ['oracle_b2c_service_update_contact', 'PATCH', '/services/rest/connect/v1.4/contacts/42'],
  ['oracle_b2c_service_delete_contact', 'DELETE', '/services/rest/connect/v1.4/contacts/42'],
  [
    'oracle_b2c_service_list_organizations',
    'GET',
    `/services/rest/connect/v1.4/organizations?fields=${encodeURIComponent(ORACLE_B2C_SERVICE_LIST_FIELDS.organizations)}&limit=100`,
  ],
  ['oracle_b2c_service_get_organization', 'GET', '/services/rest/connect/v1.4/organizations/42'],
  ['oracle_b2c_service_create_organization', 'POST', '/services/rest/connect/v1.4/organizations'],
  [
    'oracle_b2c_service_update_organization',
    'PATCH',
    '/services/rest/connect/v1.4/organizations/42',
  ],
  [
    'oracle_b2c_service_delete_organization',
    'DELETE',
    '/services/rest/connect/v1.4/organizations/42',
  ],
  [
    'oracle_b2c_service_list_answers',
    'GET',
    `/services/rest/connect/v1.4/answers?fields=${encodeURIComponent(ORACLE_B2C_SERVICE_LIST_FIELDS.answers)}&limit=100`,
  ],
  ['oracle_b2c_service_get_answer', 'GET', '/services/rest/connect/v1.4/answers/42'],
  ['oracle_b2c_service_create_answer', 'POST', '/services/rest/connect/v1.4/answers'],
  ['oracle_b2c_service_update_answer', 'PATCH', '/services/rest/connect/v1.4/answers/42'],
  ['oracle_b2c_service_delete_answer', 'DELETE', '/services/rest/connect/v1.4/answers/42'],
] as const

describe('Oracle B2C Service tool surface', () => {
  it('registers exactly the 21 block operations and gives every operation a canvas sentence', () => {
    expect(tools).toHaveLength(21)
    expect(new Set(tools.map((tool) => tool.id)).size).toBe(21)
    expect(new Set(OracleB2CServiceBlock.tools.access)).toEqual(
      new Set(tools.map((tool) => tool.id))
    )

    const operation = OracleB2CServiceBlock.subBlocks.find(
      (subBlock) => subBlock.id === 'operation'
    )
    const optionIds = operation?.options?.map((option) => option.id) ?? []
    expect(optionIds).toHaveLength(21)
    expect(
      Object.keys(OracleB2CServiceBlock.canvasPresentation?.sentences?.byOperation ?? {})
    ).toEqual(optionIds)
  })

  it('maps the response-specific subject input to the incident response tool', () => {
    const params = OracleB2CServiceBlock.tools.config.params?.({
      operation: 'create_incident_response',
      subject: 'Unrelated incident subject',
      responseSubject: 'Response subject',
    })

    expect(params).toMatchObject({
      operation: undefined,
      subject: 'Response subject',
      responseSubject: undefined,
    })
  })

  it.each(operationCases)('%s uses the documented %s endpoint', (id, method, path) => {
    const tool = toolsById[id]
    expect(tool).toBeDefined()
    expect(tool.request.method).toBe(method)
    expect(requestUrl(tool, { ...auth, id: '42' })).toBe(`${auth.siteUrl}${path}`)
  })

  it('applies Basic auth and Oracle application context to every operation', () => {
    for (const tool of tools) {
      const headers = tool.request.headers(auth)
      expect(headers.Accept).toBe('application/json')
      expect(headers.Authorization).toBe(`Basic ${Buffer.from('agent:secret').toString('base64')}`)
      expect(headers['OSvC-CREST-Application-Context']).toBe('Sim Tests')
      if (['POST', 'PATCH'].includes(tool.request.method as string)) {
        expect(headers['Content-Type']).toBe('application/json')
      } else {
        expect(headers['Content-Type']).toBeUndefined()
      }
    }
    expect(
      buildOracleHeaders({ ...auth, applicationContext: undefined })[
        'OSvC-CREST-Application-Context'
      ]
    ).toBe('Sim')
  })
})

describe('Oracle B2C Service URL and pagination boundaries', () => {
  it('accepts only an HTTPS origin as siteUrl', () => {
    expect(normalizeSiteUrl('https://example.custhelp.com/')).toBe('https://example.custhelp.com')
    expect(() => normalizeSiteUrl('http://example.custhelp.com')).toThrow('must use HTTPS')
    expect(() => normalizeSiteUrl('https://example.custhelp.com/path')).toThrow('origin only')
    expect(() => normalizeSiteUrl('https://user:pass@example.custhelp.com')).toThrow('origin only')
    expect(() => normalizeSiteUrl('https://example.custhelp.com?q=1')).toThrow('origin only')
  })

  it('builds a bounded first page with filtering, sorting, offset, and totals', () => {
    const url = buildCollectionUrl(
      {
        ...auth,
        q: 'statusWithType.status.id=1',
        orderBy: 'updatedTime:desc',
        limit: 250,
        offset: 10,
        includeTotalResults: true,
      },
      'incidents'
    )
    expect(new URL(url).searchParams).toEqual(
      new URLSearchParams({
        fields: ORACLE_B2C_SERVICE_LIST_FIELDS.incidents,
        limit: '250',
        q: 'statusWithType.status.id=1',
        orderBy: 'updatedTime:desc',
        offset: '10',
        totalResults: 'true',
      })
    )
    expect(() => buildCollectionUrl({ ...auth, limit: 1001 }, 'incidents')).toThrow('1 to 1000')
    expect(() => buildCollectionUrl({ ...auth, offset: -1 }, 'incidents')).toThrow(
      'non-negative integer'
    )
  })

  it('accepts only the same-origin URL for the same collection as pageUrl', () => {
    const pageUrl = `https://example.custhelp.com/services/rest/connect/v1.4/incidents?fields=${encodeURIComponent(ORACLE_B2C_SERVICE_LIST_FIELDS.incidents)}&limit=100&offset=100`
    expect(buildCollectionUrl({ ...auth, pageUrl }, 'incidents')).toBe(pageUrl)
    expect(() => buildCollectionUrl({ ...auth, pageUrl, q: 'id>1' }, 'incidents')).toThrow(
      'mutually exclusive'
    )
    expect(() =>
      buildCollectionUrl({ ...auth, pageUrl: pageUrl.replace('example', 'attacker') }, 'incidents')
    ).toThrow('same Oracle site')
    expect(() =>
      buildCollectionUrl(
        { ...auth, pageUrl: pageUrl.replace('incidents', 'contacts') },
        'incidents'
      )
    ).toThrow('incidents collection')
  })

  it('keeps supplied page URLs within the same fixed projection and page bound', () => {
    const base = 'https://example.custhelp.com/services/rest/connect/v1.4/incidents'
    expect(() =>
      buildCollectionUrl({ ...auth, pageUrl: `${base}?limit=20000` }, 'incidents')
    ).toThrow('pageUrl limit must be an integer from 1 to 1000')
    expect(() =>
      buildCollectionUrl({ ...auth, pageUrl: `${base}?limit=100&limit=1` }, 'incidents')
    ).toThrow('must appear only once')
    expect(() =>
      buildCollectionUrl({ ...auth, pageUrl: `${base}?limit=not-a-number` }, 'incidents')
    ).toThrow('pageUrl limit must be an integer')
    expect(() =>
      buildCollectionUrl({ ...auth, pageUrl: `${base}?limit=100&expand=threads` }, 'incidents')
    ).toThrow('unsupported query parameter')
    expect(() =>
      buildCollectionUrl({ ...auth, pageUrl: `${base}?fields=id&limit=100` }, 'incidents')
    ).toThrow('fixed incidents list projection')
  })

  it('expands incident threads only when explicitly requested', () => {
    const tool = toolsById.oracle_b2c_service_get_incident
    expect(requestUrl(tool, { ...auth, id: '42' })).toBe(
      `${auth.siteUrl}/services/rest/connect/v1.4/incidents/42`
    )
    expect(requestUrl(tool, { ...auth, id: '42', includeThreads: true })).toBe(
      `${auth.siteUrl}/services/rest/connect/v1.4/incidents/42?expand=threads`
    )
  })
})

describe('Oracle B2C Service request bodies', () => {
  it('builds incident creates and updates with documented nested references', () => {
    expect(
      requestBody(toolsById.oracle_b2c_service_create_incident, {
        ...auth,
        subject: 'Printer offline',
        primaryContactId: '12',
        organizationId: '7',
        statusId: '1',
        assignedAccountId: '8',
        assignedStaffGroupId: '9',
        customFields: { c: { source: 'sim' } },
      })
    ).toEqual({
      subject: 'Printer offline',
      primaryContact: { id: 12 },
      organization: { id: 7 },
      statusWithType: { status: { id: 1 } },
      assignedTo: { account: { id: 8 }, staffGroup: { id: 9 } },
      customFields: { c: { source: 'sim' } },
    })
    expect(
      requestBody(toolsById.oracle_b2c_service_update_incident, {
        ...auth,
        id: '42',
        subject: '',
      })
    ).toEqual({ subject: '' })
  })

  it('builds the documented incidentResponse envelope', () => {
    expect(
      requestBody(toolsById.oracle_b2c_service_create_incident_response, {
        ...auth,
        incidentId: '42',
        text: 'We restored service.',
        subject: 'Resolved',
        ccEmails: ['manager@example.com'],
        bccEmails: [],
        useEmailSignature: false,
      })
    ).toEqual({
      incident: {
        id: 42,
        subject: 'Resolved',
        threads: [
          {
            text: 'We restored service.',
            channel: { id: 9 },
            entryType: { id: 2 },
          },
        ],
      },
      cc: { emailAddresses: ['manager@example.com'] },
      bcc: { emailAddresses: [] },
      useEmailSignature: false,
    })
  })

  it('builds contact creates and updates without a raw payload escape hatch', () => {
    const body = requestBody(toolsById.oracle_b2c_service_create_contact, {
      ...auth,
      firstName: 'Ada',
      lastName: 'Lovelace',
      organizationId: '7',
      disabled: false,
      emails: [{ address: 'ada@example.com', addressTypeId: '1' }],
    })
    expect(body).toEqual({
      name: { first: 'Ada', last: 'Lovelace' },
      organization: { id: 7 },
      disabled: false,
      emails: [{ address: 'ada@example.com', addressType: { id: 1 } }],
    })
    expect(
      requestBody(toolsById.oracle_b2c_service_create_contact, { ...auth, title: 'Engineer' })
    ).toEqual({ title: 'Engineer' })
  })

  it('builds organization creates and updates', () => {
    expect(
      requestBody(toolsById.oracle_b2c_service_create_organization, {
        ...auth,
        name: 'Analytical Engines',
        parentOrganizationId: '4',
        industryId: '6',
        numberOfEmployees: 10,
      })
    ).toEqual({
      name: 'Analytical Engines',
      parent: { id: 4 },
      industry: { id: 6 },
      numberOfEmployees: 10,
    })
    expect(
      requestBody(toolsById.oracle_b2c_service_update_organization, {
        ...auth,
        id: '42',
        externalReference: '12345',
      })
    ).toEqual({ externalReference: '12345' })
  })

  it('builds Classic Answer creates and updates without writing statusType', () => {
    const body = requestBody(toolsById.oracle_b2c_service_create_answer, {
      ...auth,
      answerTypeId: '1',
      languageId: '1',
      summary: 'Reset a password',
      question: 'How do I reset my password?',
      solution: 'Use the reset link.',
      statusId: '2',
    })
    expect(body).toEqual({
      answerType: { id: 1 },
      language: { id: 1 },
      summary: 'Reset a password',
      question: 'How do I reset my password?',
      solution: 'Use the reset link.',
      statusWithType: { status: { id: 2 } },
    })
    expect(JSON.stringify(body)).not.toContain('statusType')
  })

  it('rejects empty patches, invalid custom fields, missing required text, and unsafe body IDs', () => {
    for (const id of [
      'oracle_b2c_service_update_incident',
      'oracle_b2c_service_update_contact',
      'oracle_b2c_service_update_organization',
      'oracle_b2c_service_update_answer',
    ]) {
      expect(() => requestBody(toolsById[id], { ...auth, id: '42' })).toThrow('at least one field')
    }
    expect(() =>
      requestBody(toolsById.oracle_b2c_service_update_answer, {
        ...auth,
        id: '42',
        customFields: [],
      })
    ).toThrow('customFields must be a JSON object')
    expect(() =>
      requestBody(toolsById.oracle_b2c_service_update_contact, {
        ...auth,
        id: '42',
        externalReference: 'crm-123',
      })
    ).toThrow('externalReference must contain 1-20 digits')
    expect(() =>
      requestBody(toolsById.oracle_b2c_service_update_organization, {
        ...auth,
        id: '42',
        numberOfEmployees: 2147483648,
      })
    ).toThrow('numberOfEmployees must be an integer')
    expect(() =>
      requestBody(toolsById.oracle_b2c_service_create_incident, {
        ...auth,
        subject: '  ',
        primaryContactId: '1',
      })
    ).toThrow('Incident subject is required')
    expect(() => toSafeOracleNumberId('9007199254740992', 'Contact ID')).toThrow(
      'safe integer range'
    )
  })
})

describe('Oracle B2C Service response projection', () => {
  const incident = {
    id: 42,
    lookupName: 'Incident 42',
    subject: 'Printer offline',
    primaryContact: {
      links: [
        {
          rel: 'canonical',
          href: 'https://example.custhelp.com/services/rest/connect/v1.4/contacts/12',
        },
      ],
    },
    queue: { id: 3, lookupName: 'Tier 1' },
    severity: { id: 2, lookupName: 'High' },
    statusWithType: {
      status: { id: 1, lookupName: 'Unresolved' },
      statusType: { id: 1, lookupName: 'Unresolved' },
    },
    assignedTo: {
      account: {
        links: [
          {
            rel: 'canonical',
            href: 'https://example.custhelp.com/services/rest/connect/v1.4/accounts/8',
          },
        ],
      },
      staffGroup: { id: 4, lookupName: 'Support' },
    },
    threads: {
      items: [
        {
          id: 2,
          text: 'Help',
          channel: { id: 9, lookupName: 'Email' },
          entryType: { id: 2, lookupName: 'Response' },
        },
      ],
      links: [],
    },
  }
  const contact = {
    id: 12,
    name: { first: 'Ada', last: 'Lovelace' },
    disabled: false,
    organization: {
      links: [
        {
          rel: 'canonical',
          href: 'https://example.custhelp.com/services/rest/connect/v1.4/organizations/7',
        },
      ],
    },
    emails: {
      items: [{ address: 'ada@example.com', addressType: { id: 1, lookupName: 'Primary' } }],
      links: [],
    },
    phones: { items: [], links: [] },
  }
  const organization = {
    id: 7,
    name: 'Analytical Engines',
    numberOfEmployees: 10,
    parent: {
      links: [
        {
          rel: 'canonical',
          href: 'https://example.custhelp.com/services/rest/connect/v1.4/organizations/4',
        },
      ],
    },
    industry: { id: 6, lookupName: 'Technology' },
  }
  const answer = {
    id: 3,
    summary: 'Reset a password',
    answerType: { id: 1, lookupName: 'HTML' },
    language: { id: 1, lookupName: 'en_US' },
  }

  it('normalizes documented resources to typed nulls and arrays', () => {
    expect(mapIncident(incident)).toMatchObject({
      id: '42',
      subject: 'Printer offline',
      organization: null,
      primaryContact: {
        links: [
          {
            rel: 'canonical',
            href: 'https://example.custhelp.com/services/rest/connect/v1.4/contacts/12',
          },
        ],
      },
      queue: { id: '3', lookupName: 'Tier 1' },
      assignedTo: {
        account: {
          links: [
            {
              rel: 'canonical',
              href: 'https://example.custhelp.com/services/rest/connect/v1.4/accounts/8',
            },
          ],
        },
        staffGroup: { id: '4', lookupName: 'Support' },
      },
      customFields: null,
      threads: [{ id: '2', text: 'Help' }],
    })
    expect(mapContact(contact)).toMatchObject({
      id: '12',
      disabled: false,
      phones: [],
      emails: [{ address: 'ada@example.com', addressType: { id: '1', lookupName: 'Primary' } }],
      organization: {
        links: [
          {
            rel: 'canonical',
            href: 'https://example.custhelp.com/services/rest/connect/v1.4/organizations/7',
          },
        ],
      },
    })
    expect(mapOrganization(organization)).toMatchObject({
      id: '7',
      parent: {
        links: [
          {
            rel: 'canonical',
            href: 'https://example.custhelp.com/services/rest/connect/v1.4/organizations/4',
          },
        ],
      },
      industry: { id: '6', lookupName: 'Technology' },
    })
    expect(mapAnswer(answer)).toMatchObject({ id: '3', solution: null, customFields: null })
  })

  it('does not expose unrequested heavy detail fields in list summaries', async () => {
    const incidentResult = await toolsById.oracle_b2c_service_list_incidents.transformResponse?.(
      jsonResponse({ items: [incident], hasMore: false, links: [] }),
      auth
    )
    const answerResult = await toolsById.oracle_b2c_service_list_answers.transformResponse?.(
      jsonResponse({ items: [{ ...answer, question: 'Question', solution: 'Long solution' }] }),
      auth
    )
    expect(incidentResult?.output.items[0]).not.toHaveProperty('threads')
    expect(incidentResult?.output.items[0]).not.toHaveProperty('customFields')
    expect(answerResult?.output.items[0]).not.toHaveProperty('question')
    expect(answerResult?.output.items[0]).not.toHaveProperty('solution')
  })

  it.each(operationCases)('%s transforms its documented success shape', async (id) => {
    const tool = toolsById[id]
    const params = { ...auth, id: '42' }
    let response: Response
    if (id.includes('_list_')) {
      const item = id.endsWith('incidents')
        ? incident
        : id.endsWith('contacts')
          ? contact
          : id.endsWith('organizations')
            ? organization
            : answer
      response = jsonResponse({
        items: [item],
        hasMore: true,
        totalResults: 4,
        links: [
          {
            rel: 'next',
            href: `/services/rest/connect/v1.4/${id.split('_list_')[1]}?offset=1&limit=1`,
          },
        ],
      })
    } else if (id.includes('_update_') || id.includes('_delete_')) {
      response = new Response(null, { status: 200 })
    } else if (id.endsWith('create_incident_response')) {
      response = jsonResponse({ incident: { id: 42, lookupName: 'Incident 42' } })
    } else {
      response = jsonResponse(
        id.endsWith('incident')
          ? incident
          : id.endsWith('contact')
            ? contact
            : id.endsWith('organization')
              ? organization
              : answer
      )
    }

    const result = await tool.transformResponse?.(response, params)
    expect(result?.success).toBe(true)
    if (id.includes('_list_')) {
      expect(result?.output).toMatchObject({ count: 1, hasMore: true, totalResults: 4 })
      expect(result?.output.nextPageUrl).toContain(auth.siteUrl)
    } else if (id.includes('_update_')) {
      expect(result?.output).toEqual({ id: '42', updated: true })
    } else if (id.includes('_delete_')) {
      expect(result?.output).toEqual({ id: '42', deleted: true })
    }
  })

  it('extracts Oracle problem detail and error code', async () => {
    const response = jsonResponse(
      {
        title: 'Invalid input',
        detail: 'The query is malformed.',
        'o:errorCode': 'OSC-CREST-00015',
      },
      400
    )
    await expect(
      toolsById.oracle_b2c_service_list_incidents.transformResponse?.(response, auth)
    ).rejects.toThrow('The query is malformed. (OSC-CREST-00015)')
  })

  it('rejects an unsafe numeric response ID instead of returning corrupted digits', () => {
    expect(() => readOracleId(9007199254740992, 'Incident ID')).toThrow('safe integer range')
    expect(readOracleId('9223372036854775807', 'Incident ID')).toBe('9223372036854775807')
  })
})
