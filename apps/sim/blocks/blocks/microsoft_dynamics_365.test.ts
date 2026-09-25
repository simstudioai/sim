import { describe, expect, it } from 'vitest'
import { MicrosoftDynamics365Block } from '@/blocks/blocks/microsoft_dynamics_365'

const BASE_PARAMS = {
  credential: 'credential-1',
  environmentUrl: 'https://contoso.crm.dynamics.com',
}

function mapParams(params: Record<string, unknown>) {
  const mapper = MicrosoftDynamics365Block.tools.config?.params
  if (!mapper) throw new Error('Dynamics 365 CRM block is missing its params mapper')
  return mapper({ ...BASE_PARAMS, ...params })
}

describe('MicrosoftDynamics365Block', () => {
  it('builds operation-specific generic record params and rejects non-object record JSON', () => {
    expect(
      mapParams({
        operation: 'list_records',
        recordType: 'account',
        listSelect: ' name,accountid ',
        listFilter: 'statecode eq 0',
        listOrderBy: 'createdon desc',
        recordExpand: 'primarycontactid',
        maxResults: '100',
        includeCount: false,
        nextLink: `${BASE_PARAMS.environmentUrl}/api/data/v9.2/accounts?$skiptoken=opaque`,
        nextPageSize: '100',
        data: '{"stale":true}',
        leadId: 'stale-lead',
      })
    ).toEqual({
      ...BASE_PARAMS,
      entitySetName: 'accounts',
      select: 'name,accountid',
      filter: 'statecode eq 0',
      orderBy: 'createdon desc',
      expand: 'primarycontactid',
      pageSize: 100,
      count: 'false',
      nextLink: `${BASE_PARAMS.environmentUrl}/api/data/v9.2/accounts?$skiptoken=opaque`,
      nextPageSize: 100,
    })

    expect(
      mapParams({
        operation: 'get_record',
        recordType: 'case',
        recordId: ' {11111111-1111-4111-8111-111111111111} ',
        listSelect: 'title,statuscode',
      })
    ).toEqual({
      ...BASE_PARAMS,
      entitySetName: 'incidents',
      recordId: '11111111-1111-4111-8111-111111111111',
      select: 'title,statuscode',
    })

    expect(
      mapParams({
        operation: 'create_record',
        recordType: 'contact',
        data: '{"firstname":"Ada","lastname":"Lovelace"}',
      })
    ).toEqual({
      ...BASE_PARAMS,
      entitySetName: 'contacts',
      data: { firstname: 'Ada', lastname: 'Lovelace' },
    })

    expect(() =>
      mapParams({ operation: 'create_record', recordType: 'contact', data: '[1,2]' })
    ).toThrow('Record data must be a JSON object')
    expect(() =>
      mapParams({
        operation: 'update_record',
        recordType: 'contact',
        recordId: '11111111-1111-4111-8111-111111111111',
        data: '{',
      })
    ).toThrow('Invalid JSON for Record data')
    expect(() =>
      mapParams({ operation: 'list_records', recordType: 'account', maxResults: '101' })
    ).toThrow('Max results must be at most 100')
    expect(mapParams({ operation: 'list_records', recordType: 'account' })).toMatchObject({
      pageSize: 100,
    })
    expect(
      mapParams({
        operation: 'list_records',
        recordType: 'account',
        nextLink: `${BASE_PARAMS.environmentUrl}/api/data/v9.2/accounts?$skiptoken=opaque`,
        nextPageSize: '25',
      })
    ).toEqual({
      ...BASE_PARAMS,
      entitySetName: 'accounts',
      count: 'false',
      nextLink: `${BASE_PARAMS.environmentUrl}/api/data/v9.2/accounts?$skiptoken=opaque`,
      nextPageSize: 25,
    })
    expect(() =>
      mapParams({
        operation: 'list_records',
        recordType: 'account',
        nextLink: `${BASE_PARAMS.environmentUrl}/api/data/v9.2/accounts?$skiptoken=opaque`,
      })
    ).toThrow('Next page size is required when Next Page URL is provided')
    expect(() =>
      mapParams({
        operation: 'list_records',
        recordType: 'account',
        maxResults: '100',
        nextLink: `${BASE_PARAMS.environmentUrl}/api/data/v9.2/accounts?$skiptoken=opaque`,
        nextPageSize: '25',
      })
    ).toThrow('Max results must match Next page size')
    expect(
      mapParams({
        operation: 'search_records',
        recordType: 'account',
        searchTerm: 'Contoso',
        searchSkip: '0',
        searchFilter: ' statecode eq 0 ',
        searchFacets: ' ["ownerid,count:100"] ',
        searchOrderBy: ' ["createdon desc"] ',
      })
    ).toMatchObject({
      skip: 0,
      filter: 'statecode eq 0',
      facets: '["ownerid,count:100"]',
      orderBy: '["createdon desc"]',
    })
    expect(() =>
      mapParams({
        operation: 'search_records',
        recordType: 'account',
        searchTerm: 'Contoso',
        searchSkip: '-1',
      })
    ).toThrow('Search offset must be at least 0')
    expect(() =>
      mapParams({
        operation: 'search_records',
        recordType: 'account',
        searchTerm: 'x'.repeat(101),
      })
    ).toThrow('Search term must be at most 100 characters')
  })

  it('assigns records with a validated user or team OData binding', () => {
    const recordId = '11111111-1111-4111-8111-111111111111'
    const ownerId = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'

    expect(
      mapParams({
        operation: 'assign_record',
        recordType: 'opportunity',
        recordId,
        ownerType: 'user',
        ownerId: `{${ownerId}}`,
        data: '{"stale":true}',
      })
    ).toEqual({
      ...BASE_PARAMS,
      entitySetName: 'opportunities',
      recordId,
      data: {
        'ownerid@odata.bind': `/systemusers(${ownerId})`,
      },
    })

    expect(
      mapParams({
        operation: 'assign_record',
        recordType: 'case',
        recordId,
        ownerType: 'team',
        ownerId,
      }).data
    ).toEqual({ 'ownerid@odata.bind': `/teams(${ownerId})` })

    expect(() =>
      mapParams({
        operation: 'assign_record',
        recordType: 'case',
        recordId,
        ownerType: 'user',
        ownerId: 'not-a-guid',
      })
    ).toThrow('Owner ID must be a valid GUID')
  })

  it('preserves explicit false and zero values when qualifying a lead', () => {
    expect(
      mapParams({
        operation: 'qualify_lead',
        leadId: '11111111-1111-4111-8111-111111111111',
        createAccount: false,
        createContact: 'false',
        createOpportunity: 0,
        qualifyStatusReason: '0',
        qualifyOpportunityCurrencyId: 'stale-currency',
        qualifyOpportunityCustomerId: 'stale-customer',
        qualifyOpportunityCustomerType: 'contact',
        qualifySourceCampaignId: 'stale-campaign',
        qualifyProcessInstanceId: 'stale-process-id',
        qualifyProcessInstanceEntityType: 'stale_process',
      })
    ).toEqual({
      ...BASE_PARAMS,
      leadId: '11111111-1111-4111-8111-111111111111',
      createAccount: false,
      createContact: false,
      createOpportunity: false,
      statusReason: 0,
    })

    expect(() =>
      mapParams({
        operation: 'qualify_lead',
        leadId: '11111111-1111-4111-8111-111111111111',
        createAccount: 'yes',
      })
    ).toThrow('Create account must be true or false')
  })

  it('maps optional lead qualification references only for requested opportunity creation', () => {
    expect(
      mapParams({
        operation: 'qualify_lead',
        leadId: '11111111-1111-4111-8111-111111111111',
        createAccount: true,
        createContact: false,
        createOpportunity: true,
        qualifyOpportunityCurrencyId: '22222222-2222-4222-8222-222222222222',
        qualifyOpportunityCustomerId: '33333333-3333-4333-8333-333333333333',
        qualifyOpportunityCustomerType: 'contact',
        qualifySourceCampaignId: '44444444-4444-4444-8444-444444444444',
        qualifyProcessInstanceId: '55555555-5555-4555-8555-555555555555',
        qualifyProcessInstanceEntityType: 'leadtoopportunitysalesprocess',
      })
    ).toEqual({
      ...BASE_PARAMS,
      leadId: '11111111-1111-4111-8111-111111111111',
      createAccount: true,
      createContact: false,
      createOpportunity: true,
      opportunityCurrencyId: '22222222-2222-4222-8222-222222222222',
      opportunityCustomerId: '33333333-3333-4333-8333-333333333333',
      opportunityCustomerType: 'contact',
      sourceCampaignId: '44444444-4444-4444-8444-444444444444',
      processInstanceId: '55555555-5555-4555-8555-555555555555',
      processInstanceEntityType: 'leadtoopportunitysalesprocess',
    })

    expect(() =>
      mapParams({
        operation: 'qualify_lead',
        leadId: '11111111-1111-4111-8111-111111111111',
        createOpportunity: true,
        qualifyOpportunityCustomerId: '33333333-3333-4333-8333-333333333333',
      })
    ).toThrow('Opportunity customer type is required')

    expect(() =>
      mapParams({
        operation: 'qualify_lead',
        leadId: '11111111-1111-4111-8111-111111111111',
        createOpportunity: true,
        qualifyProcessInstanceId: '55555555-5555-4555-8555-555555555555',
      })
    ).toThrow('Process instance ID and process instance table must be provided together')
  })

  it('maps opportunity and case closure without losing valid zero values', () => {
    expect(
      mapParams({
        operation: 'close_opportunity',
        closeOpportunityId: '11111111-1111-4111-8111-111111111111',
        opportunityOutcome: 'lost',
        opportunitySubject: 'Budget unavailable',
        opportunityDescription: 'Revisit next quarter',
        opportunityStatusReason: '0',
        caseDescription: 'stale case value',
      })
    ).toEqual({
      ...BASE_PARAMS,
      opportunityId: '11111111-1111-4111-8111-111111111111',
      outcome: 'lost',
      subject: 'Budget unavailable',
      description: 'Revisit next quarter',
      statusReason: 0,
    })

    expect(
      mapParams({
        operation: 'close_case',
        caseId: '22222222-2222-4222-8222-222222222222',
        caseSubject: 'Issue resolved',
        caseDescription: 'Configuration corrected',
        caseTimeSpent: '0',
        caseStatusReason: '0',
        opportunityDescription: 'stale opportunity value',
      })
    ).toEqual({
      ...BASE_PARAMS,
      caseId: '22222222-2222-4222-8222-222222222222',
      subject: 'Issue resolved',
      description: 'Configuration corrected',
      timeSpent: 0,
      statusReason: 0,
    })

    expect(() =>
      mapParams({
        operation: 'close_case',
        caseId: '22222222-2222-4222-8222-222222222222',
        caseSubject: 'Issue resolved',
        caseTimeSpent: '-1',
      })
    ).toThrow('Time spent must be at least 0')
    expect(() =>
      mapParams({
        operation: 'close_case',
        caseId: '22222222-2222-4222-8222-222222222222',
        caseSubject: 'Issue resolved',
        caseTimeSpent: '2147483648',
      })
    ).toThrow('Time spent must be at most 2147483647')
  })

  it('supports an optional opportunity subject and enforces close-description limits', () => {
    expect(
      mapParams({
        operation: 'close_opportunity',
        closeOpportunityId: '11111111-1111-4111-8111-111111111111',
        opportunityOutcome: 'won',
      })
    ).toEqual({
      ...BASE_PARAMS,
      opportunityId: '11111111-1111-4111-8111-111111111111',
      outcome: 'won',
    })
    expect(
      mapParams({
        operation: 'close_opportunity',
        closeOpportunityId: '11111111-1111-4111-8111-111111111111',
        opportunityOutcome: 'lost',
        opportunityDescription: 'x'.repeat(2_000),
      })
    ).toMatchObject({ description: 'x'.repeat(2_000) })
    expect(() =>
      mapParams({
        operation: 'close_opportunity',
        closeOpportunityId: '11111111-1111-4111-8111-111111111111',
        opportunityDescription: 'x'.repeat(2_001),
      })
    ).toThrow('Close notes must be at most 2000 characters')
    expect(
      mapParams({
        operation: 'close_case',
        caseId: '22222222-2222-4222-8222-222222222222',
        caseSubject: 'Issue resolved',
        caseDescription: 'x'.repeat(100_000),
      })
    ).toMatchObject({ description: 'x'.repeat(100_000) })
    expect(() =>
      mapParams({
        operation: 'close_case',
        caseId: '22222222-2222-4222-8222-222222222222',
        caseSubject: 'Issue resolved',
        caseDescription: 'x'.repeat(100_001),
      })
    ).toThrow('Resolution notes must be at most 100000 characters')
    expect(
      MicrosoftDynamics365Block.subBlocks.find(({ id }) => id === 'opportunitySubject')?.required
    ).toBeUndefined()
  })
})
