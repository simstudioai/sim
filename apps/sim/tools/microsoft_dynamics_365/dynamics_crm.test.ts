/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { microsoftDynamics365CloseCaseTool } from '@/tools/microsoft_dynamics_365/close_case'
import { microsoftDynamics365CloseOpportunityTool } from '@/tools/microsoft_dynamics_365/close_opportunity'
import { microsoftDynamics365CreateRecordTool } from '@/tools/microsoft_dynamics_365/create_record'
import { microsoftDynamics365GetRecordTool } from '@/tools/microsoft_dynamics_365/get_record'
import { microsoftDynamics365ListRecordsTool } from '@/tools/microsoft_dynamics_365/list_records'
import { microsoftDynamics365QualifyLeadTool } from '@/tools/microsoft_dynamics_365/qualify_lead'
import { microsoftDynamics365SearchRecordsTool } from '@/tools/microsoft_dynamics_365/search_records'
import type {
  DataverseCloseCaseParams,
  DataverseCloseOpportunityParams,
  DataverseCreateRecordParams,
  DataverseGetRecordParams,
  DataverseListRecordsParams,
  DataverseQualifyLeadParams,
  DataverseSearchParams,
} from '@/tools/microsoft_dynamics_365/types'
import { microsoftDynamics365UpdateRecordTool } from '@/tools/microsoft_dynamics_365/update_record'
import {
  DATAVERSE_MAX_ERROR_BODY_BYTES,
  getDynamics365BaseUrl,
  normalizeDataverseGuid,
} from '@/tools/microsoft_dynamics_365/utils'

const ENVIRONMENT_ALIAS = 'https://contoso.crm.dynamics.com'
const ENVIRONMENT_URL = 'https://contoso.api.crm.dynamics.com'
const ACCESS_TOKEN = 'test-access-token'
const LEAD_ID = '11111111-1111-4111-8111-111111111111'
const OPPORTUNITY_ID = '22222222-2222-4222-8222-222222222222'
const CASE_ID = '33333333-3333-4333-8333-333333333333'
const CURRENCY_ID = '44444444-4444-4444-8444-444444444444'
const CUSTOMER_ID = '55555555-5555-4555-8555-555555555555'
const CAMPAIGN_ID = '66666666-6666-4666-8666-666666666666'
const PROCESS_INSTANCE_ID = '77777777-7777-4777-8777-777777777777'

const LIST_PARAMS: DataverseListRecordsParams = {
  accessToken: ACCESS_TOKEN,
  instanceUrl: ENVIRONMENT_URL,
  environmentUrl: ENVIRONMENT_ALIAS,
  entitySetName: 'accounts',
}

const SEARCH_PARAMS: DataverseSearchParams = {
  accessToken: ACCESS_TOKEN,
  instanceUrl: ENVIRONMENT_URL,
  environmentUrl: ENVIRONMENT_ALIAS,
  searchTerm: 'Contoso',
}

const QUALIFY_PARAMS: DataverseQualifyLeadParams = {
  accessToken: ACCESS_TOKEN,
  instanceUrl: ENVIRONMENT_URL,
  environmentUrl: ENVIRONMENT_ALIAS,
  leadId: LEAD_ID,
  createAccount: true,
  createContact: true,
  createOpportunity: false,
}

const CLOSE_OPPORTUNITY_PARAMS: DataverseCloseOpportunityParams = {
  accessToken: ACCESS_TOKEN,
  instanceUrl: ENVIRONMENT_URL,
  environmentUrl: ENVIRONMENT_ALIAS,
  opportunityId: OPPORTUNITY_ID,
  outcome: 'won',
  subject: 'Opportunity won',
}

const CLOSE_CASE_PARAMS: DataverseCloseCaseParams = {
  accessToken: ACCESS_TOKEN,
  instanceUrl: ENVIRONMENT_URL,
  environmentUrl: ENVIRONMENT_ALIAS,
  caseId: CASE_ID,
  subject: 'Case resolved',
}

function resolveUrl<P>(url: string | ((params: P) => string), params: P): string {
  return typeof url === 'function' ? url(params) : url
}

describe('Microsoft Dataverse Dynamics CRM shared safety', () => {
  it('uses only additive Dynamics 365 tool IDs', () => {
    expect([
      microsoftDynamics365ListRecordsTool.id,
      microsoftDynamics365GetRecordTool.id,
      microsoftDynamics365CreateRecordTool.id,
      microsoftDynamics365UpdateRecordTool.id,
      microsoftDynamics365SearchRecordsTool.id,
      microsoftDynamics365QualifyLeadTool.id,
      microsoftDynamics365CloseOpportunityTool.id,
      microsoftDynamics365CloseCaseTool.id,
    ]).toEqual([
      'microsoft_dynamics_365_list_records',
      'microsoft_dynamics_365_get_record',
      'microsoft_dynamics_365_create_record',
      'microsoft_dynamics_365_update_record',
      'microsoft_dynamics_365_search_records',
      'microsoft_dynamics_365_qualify_lead',
      'microsoft_dynamics_365_close_opportunity',
      'microsoft_dynamics_365_close_case',
    ])
  })

  it.each([
    microsoftDynamics365ListRecordsTool,
    microsoftDynamics365GetRecordTool,
    microsoftDynamics365CreateRecordTool,
    microsoftDynamics365UpdateRecordTool,
    microsoftDynamics365SearchRecordsTool,
    microsoftDynamics365QualifyLeadTool,
    microsoftDynamics365CloseOpportunityTool,
    microsoftDynamics365CloseCaseTool,
  ])('$id strips OAuth authorization before following redirects', (tool) => {
    expect(tool.request.stripAuthOnRedirect).toBe(true)
  })

  it.each([
    ['https://contoso.crm.dynamics.com/', 'https://contoso.api.crm.dynamics.com'],
    ['https://contoso.crm4.dynamics.com', 'https://contoso.api.crm4.dynamics.com'],
    ['https://contoso.api.crm4.dynamics.com', 'https://contoso.api.crm4.dynamics.com'],
    ['https://contoso.crm9.dynamics.com', 'https://contoso.api.crm9.dynamics.com'],
  ])('accepts a public-cloud Dataverse environment host', (input, expected) => {
    expect(getDynamics365BaseUrl(input, expected)).toBe(expected)
  })

  it.each([
    'http://contoso.crm.dynamics.com',
    'https://user:password@contoso.crm.dynamics.com',
    'https://contoso.crm.dynamics.com:8443',
    'https://contoso.crm.dynamics.com/?tenant=other',
    'https://contoso.crm.dynamics.com/#fragment',
    'https://contoso.crm.dynamics.com/main.aspx',
    'https://contoso.crm.dynamics.com.attacker.example',
    'https://crm.dynamics.com',
    'https://contoso.crm.microsoftdynamics.de',
    'https://contoso.api.crm.microsoftdynamics.us',
    'https://contoso.crm.appsplatform.us',
    'https://contoso.api.crm.dynamics.cn',
  ])('rejects an untrusted Dataverse environment URL', (environmentUrl) => {
    expect(() => getDynamics365BaseUrl(environmentUrl, ENVIRONMENT_URL)).toThrow(
      /Dataverse environment URL/
    )
  })

  it('requires an environment-bound credential and rejects a different environment', () => {
    expect(() => getDynamics365BaseUrl(ENVIRONMENT_URL, '')).toThrow(
      'not bound to a trusted environment'
    )
    expect(() => getDynamics365BaseUrl(ENVIRONMENT_URL, 'https://other.crm.dynamics.com')).toThrow(
      'belongs to a different environment'
    )
  })

  it('rejects unsupported or path-injecting entity sets before building a request', () => {
    expect(() =>
      resolveUrl(microsoftDynamics365ListRecordsTool.request.url, {
        ...LIST_PARAMS,
        entitySetName: 'accounts/00000000-0000-0000-0000-000000000000',
      })
    ).toThrow('supported Dynamics 365 CRM entity set')
    expect(() =>
      resolveUrl(microsoftDynamics365GetRecordTool.request.url, {
        accessToken: ACCESS_TOKEN,
        instanceUrl: ENVIRONMENT_URL,
        environmentUrl: ENVIRONMENT_URL,
        entitySetName: 'custom_entities',
        recordId: LEAD_ID,
      })
    ).toThrow('supported Dynamics 365 CRM record entity set')
  })

  it('normalizes brace-wrapped GUIDs without accepting path injection', () => {
    expect(normalizeDataverseGuid(` {${LEAD_ID}} `, 'leadId')).toBe(LEAD_ID)
    expect(() => normalizeDataverseGuid(`${LEAD_ID})/contacts`, 'leadId')).toThrow(
      'leadId must be a valid GUID'
    )
    expect(() => normalizeDataverseGuid(`{${LEAD_ID}`, 'leadId')).toThrow(
      'leadId must be a valid GUID'
    )
  })
})

describe('microsoft_dynamics_365_list_records response validation', () => {
  it('uses a bounded page preference without $top for CRM continuation metadata', () => {
    const params = { ...LIST_PARAMS, pageSize: 25 }

    expect(resolveUrl(microsoftDynamics365ListRecordsTool.request.url, params)).toBe(
      `${ENVIRONMENT_URL}/api/data/v9.2/accounts`
    )
    expect(microsoftDynamics365ListRecordsTool.request.headers(params).Prefer).toContain(
      'odata.maxpagesize=25'
    )
    expect(microsoftDynamics365ListRecordsTool.request.headers(LIST_PARAMS).Prefer).toContain(
      'odata.maxpagesize=100'
    )
    expect(() =>
      microsoftDynamics365ListRecordsTool.request.headers({ ...LIST_PARAMS, pageSize: 101 })
    ).toThrow('pageSize must be an integer from 1 to 100')
    expect(() =>
      resolveUrl(microsoftDynamics365ListRecordsTool.request.url, {
        ...LIST_PARAMS,
        count: 'true&$top=5000',
      })
    ).toThrow('count must be true or false')
  })

  it('uses only a validated same-table continuation URL for the next page', () => {
    const nextLink = `${ENVIRONMENT_URL}/api/data/v9.2/accounts?$skiptoken=opaque`
    const aliasNextLink = `${ENVIRONMENT_ALIAS}/api/data/v9.2/accounts?$skiptoken=opaque`
    expect(
      resolveUrl(microsoftDynamics365ListRecordsTool.request.url, {
        ...LIST_PARAMS,
        nextLink,
        select: 'name',
        filter: 'statecode eq 0',
      })
    ).toBe(nextLink)
    expect(
      resolveUrl(microsoftDynamics365ListRecordsTool.request.url, {
        ...LIST_PARAMS,
        nextLink: aliasNextLink,
      })
    ).toBe(aliasNextLink)

    for (const invalidNextLink of [
      'https://attacker.example/api/data/v9.2/accounts?$skiptoken=opaque',
      `${ENVIRONMENT_URL}/api/data/v9.2/contacts?$skiptoken=opaque`,
      `${ENVIRONMENT_URL}/other/path?$skiptoken=opaque`,
      `${ENVIRONMENT_URL}/api/data/v9.2/accounts#fragment`,
      `https://user@contoso.crm.dynamics.com/api/data/v9.2/accounts?$skiptoken=opaque`,
      `${ENVIRONMENT_URL}/api/data/v9.2/accounts?x=${'a'.repeat(32_768)}`,
    ]) {
      expect(() =>
        resolveUrl(microsoftDynamics365ListRecordsTool.request.url, {
          ...LIST_PARAMS,
          nextLink: invalidNextLink,
        })
      ).toThrow(/nextLink/i)
    }
  })

  it('accepts an open-world OData page and preserves paging metadata', async () => {
    const response = Response.json({
      '@odata.context': `${ENVIRONMENT_URL}/api/data/v9.2/$metadata#accounts`,
      '@odata.count': 1,
      '@Microsoft.Dynamics.CRM.totalrecordcountlimitexceeded': false,
      '@odata.nextLink': `${ENVIRONMENT_URL}/api/data/v9.2/accounts?$skiptoken=opaque`,
      value: [{ accountid: 'account-1', name: 'Contoso', custom_field: 7 }],
      unrelatedFutureField: true,
    })

    await expect(
      microsoftDynamics365ListRecordsTool.transformResponse!(response, LIST_PARAMS)
    ).resolves.toEqual({
      success: true,
      output: {
        records: [{ accountid: 'account-1', name: 'Contoso', custom_field: 7 }],
        count: 1,
        totalCount: 1,
        totalCountLimitExceeded: false,
        nextLink: `${ENVIRONMENT_URL}/api/data/v9.2/accounts?$skiptoken=opaque`,
        success: true,
      },
    })
  })

  it('preserves an empty final page and valid zero count', async () => {
    await expect(
      microsoftDynamics365ListRecordsTool.transformResponse!(
        Response.json({ value: [], '@odata.count': 0 }),
        LIST_PARAMS
      )
    ).resolves.toEqual({
      success: true,
      output: {
        records: [],
        count: 0,
        totalCount: 0,
        totalCountLimitExceeded: null,
        nextLink: null,
        success: true,
      },
    })
  })

  it.each([
    {},
    { value: null },
    { value: {} },
    { value: [null] },
    { value: [], '@odata.count': '1' },
    { value: [], '@Microsoft.Dynamics.CRM.totalrecordcountlimitexceeded': 'true' },
    { value: [], '@odata.nextLink': 7 },
    { value: [], '@odata.nextLink': 'https://attacker.example/api/data/v9.2/accounts' },
    { value: [], '@odata.nextLink': `${ENVIRONMENT_URL}/api/data/v9.2/contacts?$skiptoken=x` },
    { value: [], '@odata.nextLink': `${ENVIRONMENT_URL}/other/path?$skiptoken=opaque` },
  ])('rejects a malformed successful OData page', async (payload) => {
    await expect(
      microsoftDynamics365ListRecordsTool.transformResponse!(Response.json(payload), LIST_PARAMS)
    ).rejects.toThrow(/invalid Dataverse list records response/i)
  })
})

describe('microsoft_dynamics_365_update_record errors', () => {
  it('normalizes the record GUID and rejects path injection in direct invocation', async () => {
    const params = {
      accessToken: ACCESS_TOKEN,
      instanceUrl: ENVIRONMENT_URL,
      environmentUrl: ENVIRONMENT_URL,
      entitySetName: 'accounts',
      recordId: ` {${LEAD_ID}} `,
      data: { name: 'Updated' },
    }

    expect(resolveUrl(microsoftDynamics365UpdateRecordTool.request.url, params)).toBe(
      `${ENVIRONMENT_URL}/api/data/v9.2/accounts(${LEAD_ID})`
    )
    expect(() =>
      resolveUrl(microsoftDynamics365UpdateRecordTool.request.url, {
        ...params,
        recordId: `${LEAD_ID})/contacts(${CUSTOMER_ID}`,
      })
    ).toThrow('recordId must be a valid GUID')

    await expect(
      microsoftDynamics365UpdateRecordTool.transformResponse!(
        new Response(null, { status: 204 }),
        params
      )
    ).resolves.toEqual({
      success: true,
      output: { recordId: LEAD_ID, success: true },
    })
  })

  it('surfaces bounded provider errors', async () => {
    await expect(
      microsoftDynamics365UpdateRecordTool.transformResponse!(
        Response.json({ error: { message: 'Update denied by plugin' } }, { status: 403 })
      )
    ).rejects.toThrow('Update denied by plugin')

    await expect(
      microsoftDynamics365UpdateRecordTool.transformResponse!(
        new Response('Slow down', {
          status: 429,
          statusText: 'Too Many Requests',
        })
      )
    ).rejects.toThrow('Slow down')

    await expect(
      microsoftDynamics365UpdateRecordTool.transformResponse!(
        new Response('x'.repeat(DATAVERSE_MAX_ERROR_BODY_BYTES + 1), {
          status: 429,
          statusText: 'Too Many Requests',
        })
      )
    ).rejects.toThrow('Dataverse API error: 429 Too Many Requests')
  })
})

describe('microsoft_dynamics_365 CRM record identity', () => {
  const createParams: DataverseCreateRecordParams = {
    accessToken: ACCESS_TOKEN,
    instanceUrl: ENVIRONMENT_URL,
    environmentUrl: ENVIRONMENT_URL,
    entitySetName: 'accounts',
    data: { name: 'Contoso' },
  }
  const getParams: DataverseGetRecordParams = {
    accessToken: ACCESS_TOKEN,
    instanceUrl: ENVIRONMENT_URL,
    environmentUrl: ENVIRONMENT_URL,
    entitySetName: 'accounts',
    recordId: LEAD_ID,
  }

  it('uses the mapped primary key for create instead of the first id-like response field', async () => {
    const record = {
      address1_addressid: CURRENCY_ID,
      accountid: LEAD_ID,
      name: 'Contoso',
    }

    await expect(
      microsoftDynamics365CreateRecordTool.transformResponse!(
        Response.json(record, { status: 201 }),
        createParams
      )
    ).resolves.toEqual({
      success: true,
      output: { recordId: LEAD_ID, record, success: true },
    })
  })

  it('rejects malformed or primary-key-less create representations', async () => {
    await expect(
      microsoftDynamics365CreateRecordTool.transformResponse!(
        new Response('not-json', { status: 201 }),
        createParams
      )
    ).rejects.toThrow(/expected a JSON object/)
    await expect(
      microsoftDynamics365CreateRecordTool.transformResponse!(
        Response.json({ address1_addressid: CURRENCY_ID }, { status: 201 }),
        createParams
      )
    ).rejects.toThrow(/accountid must be a GUID string/)
  })

  it('rejects non-object create and update bodies in direct invocation', () => {
    expect(() =>
      microsoftDynamics365CreateRecordTool.request.body!({
        ...createParams,
        data: [] as unknown as Record<string, unknown>,
      })
    ).toThrow('Record data must be a JSON object')
    expect(() =>
      microsoftDynamics365UpdateRecordTool.request.body!({
        accessToken: ACCESS_TOKEN,
        instanceUrl: ENVIRONMENT_URL,
        environmentUrl: ENVIRONMENT_URL,
        entitySetName: 'accounts',
        recordId: LEAD_ID,
        data: '[]' as unknown as Record<string, unknown>,
      })
    ).toThrow('Record data must be a JSON object')
  })

  it('returns the validated requested ID for get regardless of response key order', async () => {
    const record = {
      address1_addressid: CURRENCY_ID,
      accountid: LEAD_ID,
      name: 'Contoso',
    }

    await expect(
      microsoftDynamics365GetRecordTool.transformResponse!(Response.json(record), getParams)
    ).resolves.toEqual({
      success: true,
      output: { recordId: LEAD_ID, record, success: true },
    })
  })
})

describe('microsoft_dynamics_365_search response validation', () => {
  it('validates and preserves the documented bounded request values', () => {
    expect(
      microsoftDynamics365SearchRecordsTool.request.body!({
        ...SEARCH_PARAMS,
        searchTerm: '  Contoso  ',
        entities: JSON.stringify([{ name: 'account' }]),
        top: 100,
        skip: 0,
      })
    ).toEqual({
      search: 'Contoso',
      count: true,
      entities: JSON.stringify([{ name: 'account' }]),
      top: 100,
      skip: 0,
    })
  })

  it.each([
    [{ ...SEARCH_PARAMS, searchTerm: '   ' }, /searchTerm must be a non-empty string/],
    [{ ...SEARCH_PARAMS, searchTerm: 'x'.repeat(101) }, /at most 100 characters/],
    [{ ...SEARCH_PARAMS, top: 0 }, /top must be an integer from 1 to 100/],
    [{ ...SEARCH_PARAMS, top: 101 }, /top must be an integer from 1 to 100/],
    [{ ...SEARCH_PARAMS, top: 1.5 }, /top must be a 32-bit integer/],
    [{ ...SEARCH_PARAMS, skip: -1 }, /skip must be a nonnegative integer/],
    [{ ...SEARCH_PARAMS, skip: 1.5 }, /skip must be a 32-bit integer/],
    [{ ...SEARCH_PARAMS, searchMode: 'some' }, /searchMode must be any or all/],
    [{ ...SEARCH_PARAMS, searchType: 'semantic' }, /searchType must be simple or lucene/],
  ])('rejects an invalid search request', (params, expectedError) => {
    expect(() => microsoftDynamics365SearchRecordsTool.request.body!(params)).toThrow(expectedError)
  })

  it('parses the documented escaped response and tolerates unrelated fields', async () => {
    const innerResponse = {
      Error: null,
      Value: [
        {
          Id: 'record-1',
          EntityName: 'account',
          ObjectTypeCode: 1,
          Attributes: { name: 'Contoso' },
          Highlights: { name: ['{crmhit}Contoso{/crmhit}'] },
          Score: 1.5,
          futureResultField: 'preserved',
        },
      ],
      Facets: { entityname: [{ count: 1, value: 'account' }] },
      Count: 1,
      futureResponseField: true,
    }

    const response = Response.json({
      '@odata.context': `${ENVIRONMENT_URL}/api/data/v9.2/$metadata#Microsoft.Dynamics.CRM.searchqueryResponse`,
      response: JSON.stringify(innerResponse),
      unrelatedOuterField: true,
    })

    await expect(
      microsoftDynamics365SearchRecordsTool.transformResponse!(response, SEARCH_PARAMS)
    ).resolves.toEqual({
      success: true,
      output: {
        results: innerResponse.Value,
        totalCount: 1,
        count: 1,
        facets: innerResponse.Facets,
        success: true,
      },
    })
  })

  it('preserves an empty search page and valid zero count', async () => {
    await expect(
      microsoftDynamics365SearchRecordsTool.transformResponse!(
        Response.json({ response: JSON.stringify({ Error: null, Value: [], Count: 0 }) }),
        SEARCH_PARAMS
      )
    ).resolves.toEqual({
      success: true,
      output: { results: [], totalCount: 0, count: 0, facets: null, success: true },
    })
  })

  it.each([
    {},
    { response: {} },
    { response: '{not-json' },
    { response: JSON.stringify({ Count: 0 }) },
    { response: JSON.stringify({ Value: [], Count: '0' }) },
    { response: JSON.stringify({ Value: [null], Count: 1 }) },
    { response: JSON.stringify({ Value: [{}], Count: 1 }) },
    {
      response: JSON.stringify({
        Value: [
          {
            Id: 'record-1',
            EntityName: 'account',
            ObjectTypeCode: 1,
            Attributes: {},
            Score: Number.NaN,
          },
        ],
        Count: 1,
      }),
    },
    {
      response: JSON.stringify({
        Value: [
          {
            Id: 'record-1',
            EntityName: 'account',
            ObjectTypeCode: 1.5,
            Attributes: {},
            Score: 1,
          },
        ],
        Count: 1,
      }),
    },
    {
      response: JSON.stringify({
        Value: [
          {
            Id: 'record-1',
            EntityName: 'account',
            ObjectTypeCode: 1,
            Attributes: {},
            Highlights: { name: 'not-an-array' },
            Score: 1,
          },
        ],
        Count: 1,
      }),
    },
    {
      response: JSON.stringify({
        Value: [
          {
            Id: 'record-1',
            EntityName: 'account',
            ObjectTypeCode: 1,
            Attributes: {},
            Score: 1,
          },
        ],
        Facets: { entityname: 'not-an-array' },
        Count: 1,
      }),
    },
  ])('rejects a malformed successful search response', async (payload) => {
    await expect(
      microsoftDynamics365SearchRecordsTool.transformResponse!(
        Response.json(payload),
        SEARCH_PARAMS
      )
    ).rejects.toThrow(/invalid Dataverse search response/i)
  })

  it('surfaces a documented provider error delivered inside HTTP 200', async () => {
    const response = Response.json({
      response: JSON.stringify({
        Error: {
          code: 'SearchServiceError',
          message: 'Dataverse Search is unavailable for this environment',
          propertybag: { correlationId: 'correlation-1' },
        },
        Value: [],
        Count: 0,
      }),
    })

    await expect(
      microsoftDynamics365SearchRecordsTool.transformResponse!(response, SEARCH_PARAMS)
    ).rejects.toThrow('Dataverse Search is unavailable for this environment')
  })
})

describe('microsoft_dynamics_365_qualify_lead', () => {
  it('builds the exact bound action URL and conservative minimal body', () => {
    expect(resolveUrl(microsoftDynamics365QualifyLeadTool.request.url, QUALIFY_PARAMS)).toBe(
      `${ENVIRONMENT_URL}/api/data/v9.2/leads(${LEAD_ID})/Microsoft.Dynamics.CRM.QualifyLead`
    )
    expect(microsoftDynamics365QualifyLeadTool.request.method).toBe('POST')
    expect(microsoftDynamics365QualifyLeadTool.request.headers(QUALIFY_PARAMS)).toMatchObject({
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      'OData-MaxVersion': '4.0',
      'OData-Version': '4.0',
    })
    expect(microsoftDynamics365QualifyLeadTool.request.body!(QUALIFY_PARAMS)).toEqual({
      CreateAccount: true,
      CreateContact: true,
      CreateOpportunity: false,
      Status: 3,
    })
  })

  it('preserves explicit false booleans and a zero status reason', () => {
    expect(
      microsoftDynamics365QualifyLeadTool.request.body!({
        ...QUALIFY_PARAMS,
        createAccount: false,
        createContact: false,
        statusReason: 0,
      })
    ).toEqual({
      CreateAccount: false,
      CreateContact: false,
      CreateOpportunity: false,
      Status: 0,
    })
  })

  it.each([
    [false, false, false],
    [false, false, true],
    [false, true, false],
    [false, true, true],
    [true, false, false],
    [true, false, true],
    [true, true, false],
    [true, true, true],
  ])(
    'preserves the create flags for account=%s contact=%s opportunity=%s',
    (createAccount, createContact, createOpportunity) => {
      expect(
        microsoftDynamics365QualifyLeadTool.request.body!({
          ...QUALIFY_PARAMS,
          createAccount,
          createContact,
          createOpportunity,
        })
      ).toMatchObject({
        CreateAccount: createAccount,
        CreateContact: createContact,
        CreateOpportunity: createOpportunity,
      })
    }
  )

  it('serializes documented opportunity entity references only when requested', () => {
    expect(
      microsoftDynamics365QualifyLeadTool.request.body!({
        ...QUALIFY_PARAMS,
        createOpportunity: true,
        opportunityCurrencyId: CURRENCY_ID,
        opportunityCustomerId: CUSTOMER_ID,
        opportunityCustomerType: 'account',
        sourceCampaignId: CAMPAIGN_ID,
        processInstanceId: PROCESS_INSTANCE_ID,
        processInstanceEntityType: 'leadtoopportunitysalesprocess',
      })
    ).toEqual({
      CreateAccount: true,
      CreateContact: true,
      CreateOpportunity: true,
      Status: 3,
      OpportunityCurrencyId: {
        '@odata.type': 'Microsoft.Dynamics.CRM.transactioncurrency',
        transactioncurrencyid: CURRENCY_ID,
      },
      OpportunityCustomerId: {
        '@odata.type': 'Microsoft.Dynamics.CRM.account',
        accountid: CUSTOMER_ID,
      },
      SourceCampaignId: {
        '@odata.type': 'Microsoft.Dynamics.CRM.campaign',
        campaignid: CAMPAIGN_ID,
      },
      ProcessInstanceId: {
        '@odata.type': 'Microsoft.Dynamics.CRM.leadtoopportunitysalesprocess',
        businessprocessflowinstanceid: PROCESS_INSTANCE_ID,
      },
    })
  })

  it('allows opportunity creation without optional currency or customer references', () => {
    expect(
      microsoftDynamics365QualifyLeadTool.request.body!({
        ...QUALIFY_PARAMS,
        createOpportunity: true,
      })
    ).toEqual({
      CreateAccount: true,
      CreateContact: true,
      CreateOpportunity: true,
      Status: 3,
    })
  })

  it.each([
    { opportunityCurrencyId: CURRENCY_ID },
    { opportunityCustomerId: CUSTOMER_ID, opportunityCustomerType: 'contact' as const },
    { sourceCampaignId: CAMPAIGN_ID },
    {
      processInstanceId: PROCESS_INSTANCE_ID,
      processInstanceEntityType: 'leadtoopportunitysalesprocess',
    },
  ])('rejects opportunity-only details when opportunity creation is false', (details) => {
    expect(() =>
      microsoftDynamics365QualifyLeadTool.request.body!({ ...QUALIFY_PARAMS, ...details })
    ).toThrow(/only be provided when createOpportunity is true/)
  })

  it('requires customer ID and type together', () => {
    expect(() =>
      microsoftDynamics365QualifyLeadTool.request.body!({
        ...QUALIFY_PARAMS,
        createOpportunity: true,
        opportunityCustomerId: CUSTOMER_ID,
      })
    ).toThrow(/must be provided together/)
    expect(() =>
      microsoftDynamics365QualifyLeadTool.request.body!({
        ...QUALIFY_PARAMS,
        createOpportunity: true,
        opportunityCustomerId: CUSTOMER_ID,
        opportunityCustomerType: 'lead' as unknown as 'account',
      })
    ).toThrow(/must be account or contact/)
  })

  it('requires a valid process instance ID and logical table name together', () => {
    expect(() =>
      microsoftDynamics365QualifyLeadTool.request.body!({
        ...QUALIFY_PARAMS,
        createOpportunity: true,
        processInstanceId: PROCESS_INSTANCE_ID,
      })
    ).toThrow(/must be provided together/)
    expect(() =>
      microsoftDynamics365QualifyLeadTool.request.body!({
        ...QUALIFY_PARAMS,
        createOpportunity: true,
        processInstanceId: PROCESS_INSTANCE_ID,
        processInstanceEntityType: 'bad/type',
      })
    ).toThrow(/valid Dataverse logical table name/)
  })

  it('rejects a non-boolean direct invocation and an unsafe lead ID', () => {
    expect(() =>
      microsoftDynamics365QualifyLeadTool.request.body!({
        ...QUALIFY_PARAMS,
        createAccount: 0 as unknown as boolean,
      })
    ).toThrow('createAccount must be a boolean')
    expect(() =>
      resolveUrl(microsoftDynamics365QualifyLeadTool.request.url, {
        ...QUALIFY_PARAMS,
        leadId: `${LEAD_ID})/contacts`,
      })
    ).toThrow('leadId must be a valid GUID')
  })

  it('preserves an open-world QualifyLead result collection', async () => {
    const value = [
      {
        '@odata.type': '#Microsoft.Dynamics.CRM.account',
        accountid: CUSTOMER_ID,
        futureField: true,
      },
    ]
    await expect(
      microsoftDynamics365QualifyLeadTool.transformResponse!(
        Response.json({ value, futureField: 7 })
      )
    ).resolves.toEqual({ success: true, output: { createdEntities: value, success: true } })
  })

  it.each([{}, { value: null }, { value: [null] }])(
    'rejects a malformed successful QualifyLead response',
    async (payload) => {
      await expect(
        microsoftDynamics365QualifyLeadTool.transformResponse!(Response.json(payload))
      ).rejects.toThrow(/Invalid Dataverse QualifyLead response/)
    }
  )

  it('surfaces bounded JSON and text errors', async () => {
    await expect(
      microsoftDynamics365QualifyLeadTool.transformResponse!(
        Response.json(
          { error: { code: '0x8004', message: 'Lead cannot be qualified' } },
          { status: 400 }
        )
      )
    ).rejects.toThrow('Lead cannot be qualified')

    await expect(
      microsoftDynamics365QualifyLeadTool.transformResponse!(
        new Response('Plugin execution failed', { status: 403 })
      )
    ).rejects.toThrow('Plugin execution failed')

    await expect(
      microsoftDynamics365QualifyLeadTool.transformResponse!(
        new Response('x'.repeat(DATAVERSE_MAX_ERROR_BODY_BYTES + 1), {
          status: 429,
          statusText: 'Too Many Requests',
        })
      )
    ).rejects.toThrow('Dataverse API error: 429 Too Many Requests')
  })
})

describe('microsoft_dynamics_365_close_opportunity', () => {
  it('does not enable automatic retries for lifecycle mutations', () => {
    expect(microsoftDynamics365QualifyLeadTool.request.retry).toBeUndefined()
    expect(microsoftDynamics365CloseOpportunityTool.request.retry).toBeUndefined()
    expect(microsoftDynamics365CloseCaseTool.request.retry).toBeUndefined()
  })

  it.each([
    ['won' as const, 'WinOpportunity', 3],
    ['lost' as const, 'LoseOpportunity', 4],
  ])('builds the exact %s action request', (outcome, action, status) => {
    const params = { ...CLOSE_OPPORTUNITY_PARAMS, outcome }
    expect(resolveUrl(microsoftDynamics365CloseOpportunityTool.request.url, params)).toBe(
      `${ENVIRONMENT_URL}/api/data/v9.2/${action}`
    )
    expect(microsoftDynamics365CloseOpportunityTool.request.body!(params)).toEqual({
      OpportunityClose: {
        'opportunityid@odata.bind': `/opportunities(${OPPORTUNITY_ID})`,
        subject: 'Opportunity won',
      },
      Status: status,
    })
  })

  it('preserves optional text and a zero custom status reason', () => {
    expect(
      microsoftDynamics365CloseOpportunityTool.request.body!({
        ...CLOSE_OPPORTUNITY_PARAMS,
        description: '',
        statusReason: 0,
      })
    ).toEqual({
      OpportunityClose: {
        'opportunityid@odata.bind': `/opportunities(${OPPORTUNITY_ID})`,
        subject: 'Opportunity won',
        description: '',
      },
      Status: 0,
    })
  })

  it('rejects invalid outcomes, GUIDs, and subjects', () => {
    expect(() =>
      resolveUrl(microsoftDynamics365CloseOpportunityTool.request.url, {
        ...CLOSE_OPPORTUNITY_PARAMS,
        outcome: 'open' as unknown as 'won',
      })
    ).toThrow('outcome must be won or lost')
    expect(() =>
      microsoftDynamics365CloseOpportunityTool.request.body!({
        ...CLOSE_OPPORTUNITY_PARAMS,
        opportunityId: 'not-a-guid',
      })
    ).toThrow('opportunityId must be a valid GUID')
    expect(() =>
      microsoftDynamics365CloseOpportunityTool.request.body!({
        ...CLOSE_OPPORTUNITY_PARAMS,
        subject: 'x'.repeat(201),
      })
    ).toThrow(/at most 200 characters/)
  })

  it('accepts the documented 204 and returns only caller-known values', async () => {
    await expect(
      microsoftDynamics365CloseOpportunityTool.transformResponse!(
        new Response(null, { status: 204 }),
        CLOSE_OPPORTUNITY_PARAMS
      )
    ).resolves.toEqual({
      success: true,
      output: { opportunityId: OPPORTUNITY_ID, outcome: 'won', success: true },
    })
  })

  it('rejects an undocumented successful response status', async () => {
    await expect(
      microsoftDynamics365CloseOpportunityTool.transformResponse!(
        Response.json({}, { status: 200 }),
        CLOSE_OPPORTUNITY_PARAMS
      )
    ).rejects.toThrow('expected HTTP 204, received 200')
  })
})

describe('microsoft_dynamics_365_close_case', () => {
  it('builds the exact CloseIncident body and preserves zero values', () => {
    expect(resolveUrl(microsoftDynamics365CloseCaseTool.request.url, CLOSE_CASE_PARAMS)).toBe(
      `${ENVIRONMENT_URL}/api/data/v9.2/CloseIncident`
    )
    expect(
      microsoftDynamics365CloseCaseTool.request.body!({
        ...CLOSE_CASE_PARAMS,
        description: 'Resolved with customer',
        timeSpent: 0,
        statusReason: 0,
      })
    ).toEqual({
      IncidentResolution: {
        'incidentid@odata.bind': `/incidents(${CASE_ID})`,
        subject: 'Case resolved',
        description: 'Resolved with customer',
        timespent: 0,
      },
      Status: 0,
    })
  })

  it('uses the documented resolved-status default', () => {
    expect(microsoftDynamics365CloseCaseTool.request.body!(CLOSE_CASE_PARAMS)).toEqual({
      IncidentResolution: {
        'incidentid@odata.bind': `/incidents(${CASE_ID})`,
        subject: 'Case resolved',
      },
      Status: 5,
    })
  })

  it.each([-1, 1.5, 2_147_483_648])('rejects invalid time spent', (timeSpent) => {
    expect(() =>
      microsoftDynamics365CloseCaseTool.request.body!({ ...CLOSE_CASE_PARAMS, timeSpent })
    ).toThrow(/timeSpent/)
  })

  it('rejects invalid case IDs and resolution subjects', () => {
    expect(() =>
      microsoftDynamics365CloseCaseTool.request.body!({
        ...CLOSE_CASE_PARAMS,
        caseId: 'not-a-guid',
      })
    ).toThrow('caseId must be a valid GUID')
    expect(() =>
      microsoftDynamics365CloseCaseTool.request.body!({
        ...CLOSE_CASE_PARAMS,
        subject: 'x'.repeat(201),
      })
    ).toThrow(/at most 200 characters/)
  })

  it('accepts the documented 204 and returns only the caller-known case ID', async () => {
    await expect(
      microsoftDynamics365CloseCaseTool.transformResponse!(
        new Response(null, { status: 204 }),
        CLOSE_CASE_PARAMS
      )
    ).resolves.toEqual({ success: true, output: { caseId: CASE_ID, success: true } })
  })

  it('rejects an undocumented successful response status', async () => {
    await expect(
      microsoftDynamics365CloseCaseTool.transformResponse!(
        Response.json({}, { status: 200 }),
        CLOSE_CASE_PARAMS
      )
    ).rejects.toThrow('expected HTTP 204, received 200')
  })
})
