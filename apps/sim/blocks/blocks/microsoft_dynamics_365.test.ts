/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { MicrosoftDataverseBlock } from '@/blocks/blocks/microsoft_dataverse'
import {
  MicrosoftDynamics365Block,
  MicrosoftDynamics365BlockMeta,
} from '@/blocks/blocks/microsoft_dynamics_365'

const OPERATIONS = [
  'list_records',
  'get_record',
  'create_record',
  'update_record',
  'search_records',
  'list_owners',
  'assign_record',
  'qualify_lead',
  'close_opportunity',
  'close_case',
] as const

const TOOL_BY_OPERATION = {
  list_records: 'microsoft_dynamics_365_list_records',
  get_record: 'microsoft_dynamics_365_get_record',
  create_record: 'microsoft_dynamics_365_create_record',
  update_record: 'microsoft_dynamics_365_update_record',
  search_records: 'microsoft_dynamics_365_search_records',
  list_owners: 'microsoft_dynamics_365_list_records',
  assign_record: 'microsoft_dynamics_365_update_record',
  qualify_lead: 'microsoft_dynamics_365_qualify_lead',
  close_opportunity: 'microsoft_dynamics_365_close_opportunity',
  close_case: 'microsoft_dynamics_365_close_case',
} as const

const RECORD_TYPES = {
  account: { entitySetName: 'accounts', logicalName: 'account', primaryId: 'accountid' },
  contact: { entitySetName: 'contacts', logicalName: 'contact', primaryId: 'contactid' },
  lead: { entitySetName: 'leads', logicalName: 'lead', primaryId: 'leadid' },
  opportunity: {
    entitySetName: 'opportunities',
    logicalName: 'opportunity',
    primaryId: 'opportunityid',
  },
  case: { entitySetName: 'incidents', logicalName: 'incident', primaryId: 'incidentid' },
} as const

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
  it('reuses the existing Dataverse OAuth service and keeps the generic block available', () => {
    const credential = MicrosoftDynamics365Block.subBlocks.find(
      (subBlock) => subBlock.id === 'credential'
    )

    expect(credential).toMatchObject({
      type: 'oauth-input',
      serviceId: 'microsoft-dataverse',
      paramVisibility: 'user-only',
      required: true,
      dependsOn: ['environmentUrl'],
    })
    expect(MicrosoftDynamics365Block.type).toBe('microsoft_dynamics_365')
    expect(MicrosoftDataverseBlock.type).toBe('microsoft_dataverse')
    expect(
      MicrosoftDataverseBlock.subBlocks.find((subBlock) => subBlock.id === 'credential')?.dependsOn
    ).toBeUndefined()
    expect(MicrosoftDataverseBlock.tools.access).toContain('microsoft_dataverse_delete_record')
  })

  it('exposes exactly ten CRM operations with list records as the read-first default', () => {
    const operation = MicrosoftDynamics365Block.subBlocks.find(
      (subBlock) => subBlock.id === 'operation'
    )
    const options =
      typeof operation?.options === 'function' ? operation.options() : operation?.options

    expect(operation?.type).toBe('dropdown')
    expect(operation?.value?.({})).toBe('list_records')
    expect(options?.map(({ id }) => id)).toEqual(OPERATIONS)
    expect(options?.some(({ id }) => id.includes('delete'))).toBe(false)
  })

  it('routes every CRM operation to an explicitly allowed tool', () => {
    const toolSelector = MicrosoftDynamics365Block.tools.config?.tool
    expect(toolSelector).toBeDefined()

    for (const operation of OPERATIONS) {
      const toolId = toolSelector?.({ operation })
      expect(toolId).toBe(TOOL_BY_OPERATION[operation])
      expect(MicrosoftDynamics365Block.tools.access).toContain(toolId)
    }

    expect(new Set(MicrosoftDynamics365Block.tools.access)).toEqual(
      new Set(Object.values(TOOL_BY_OPERATION))
    )
    expect(() => toolSelector?.({ operation: 'delete_record' })).toThrow(
      'Unsupported Dynamics 365 CRM operation'
    )
  })

  it('uses unique subblock ids and covers every operation with a canvas sentence', () => {
    const ids = MicrosoftDynamics365Block.subBlocks.map(({ id }) => id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(
      Object.keys(MicrosoftDynamics365Block.canvasPresentation?.sentences?.byOperation ?? {})
    ).toEqual(OPERATIONS)
  })

  it('maps every supported CRM record type to the fixed Dataverse table names', () => {
    for (const [recordType, expected] of Object.entries(RECORD_TYPES)) {
      expect(mapParams({ operation: 'list_records', recordType })).toMatchObject({
        entitySetName: expected.entitySetName,
      })
      expect(
        mapParams({ operation: 'search_records', recordType, searchTerm: 'Contoso' })
      ).toMatchObject({
        entities: JSON.stringify([{ name: expected.logicalName }]),
        top: 100,
      })
    }

    expect(() => mapParams({ operation: 'list_records', recordType: 'custom_table' })).toThrow(
      'Unsupported Dynamics 365 record type'
    )
  })

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
        operation: 'search_records',
        recordType: 'account',
        searchTerm: 'Contoso',
        searchSkip: '0',
      })
    ).toMatchObject({ skip: 0 })
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

  it('lists users and teams with bounded fixed projections', () => {
    expect(mapParams({ operation: 'list_owners', ownerType: 'user', maxResults: '25' })).toEqual({
      ...BASE_PARAMS,
      entitySetName: 'systemusers',
      select: 'systemuserid,fullname,domainname,internalemailaddress,isdisabled',
      pageSize: 25,
      filter: 'isdisabled eq false',
    })
    expect(
      mapParams({
        operation: 'list_owners',
        ownerType: 'team',
        nextLink: `${BASE_PARAMS.environmentUrl}/api/data/v9.2/teams?$skiptoken=opaque`,
      })
    ).toEqual({
      ...BASE_PARAMS,
      entitySetName: 'teams',
      select: 'teamid,name,teamtype',
      pageSize: 100,
      filter: 'teamtype ne 1',
      nextLink: `${BASE_PARAMS.environmentUrl}/api/data/v9.2/teams?$skiptoken=opaque`,
    })
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

  it('declares only outputs returned by the reused and lifecycle tools', () => {
    expect(Object.keys(MicrosoftDynamics365Block.outputs)).toEqual([
      'records',
      'record',
      'recordId',
      'count',
      'totalCount',
      'totalCountLimitExceeded',
      'nextLink',
      'results',
      'facets',
      'createdEntities',
      'opportunityId',
      'outcome',
      'caseId',
      'success',
    ])
  })

  it('provides researched templates and operation-grounded skills', () => {
    expect(MicrosoftDynamics365BlockMeta.templates).toHaveLength(8)
    expect(MicrosoftDynamics365BlockMeta.skills).toHaveLength(7)

    for (const template of MicrosoftDynamics365BlockMeta.templates) {
      expect(template.title).toBeTruthy()
      expect(template.prompt).toBeTruthy()
      expect(template.modules.length).toBeGreaterThan(0)
      expect(template.category).toBeTruthy()
      expect(template.tags.length).toBeGreaterThan(0)
    }

    const skillNames = MicrosoftDynamics365BlockMeta.skills.map(({ name }) => name)
    expect(new Set(skillNames).size).toBe(skillNames.length)
    expect(
      MicrosoftDynamics365BlockMeta.skills.every(({ content }) => content.includes('## Steps'))
    ).toBe(true)
  })
})
