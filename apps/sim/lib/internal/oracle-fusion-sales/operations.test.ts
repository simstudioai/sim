/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ json: vi.fn(), empty: vi.fn() }))
vi.mock('@/lib/internal/oracle-fusion/client', () => ({
  requestOracleFusionJson: mocks.json,
  requestOracleFusionEmpty: mocks.empty,
}))

import type { OracleFusionRequest } from '@/lib/internal/oracle-fusion/client'
import { serializeOracleFusionJsonBody } from '@/lib/internal/oracle-fusion/request-body'
import {
  executeOracleFusionSalesOperation,
  listOracleFusionSalesRecords,
} from '@/lib/internal/oracle-fusion-sales/operations'

const ORIGIN = 'https://vision.fa.us2.oraclecloud.com'
const ROOT = `${ORIGIN}/crmRestApi/resources/11.13.18.05`
const AUTH = {
  oauthCredential: 'credential-1',
  accessToken: 'test-token',
  instanceUrl: ORIGIN,
}

const RECORDS: Record<string, Record<string, unknown>> = {
  account: { PartyId: 123, PartyNumber: 'A001', OrganizationName: 'Example' },
  contact: { PartyId: 123, PartyNumber: 'C001', ContactName: 'Ada Example' },
  lead: { LeadId: 123, LeadNumber: 'L001', Name: 'Inbound' },
  opportunity: { OptyId: 123, OptyNumber: 'O001', Name: 'Renewal' },
  activity: { ActivityId: 123, ActivityNumber: 'ACT001', Subject: 'Follow-up' },
  resource: { PartyId: 123, PartyNumber: 'R001', PartyName: 'Sales Owner' },
  opportunityContact: { OptyConId: 123, OptyId: 456, OptyNumber: 'O001', PERPartyId: 789 },
  revenue: {
    RevnId: 123,
    RevnNumber: 'REV001',
    OptyNumber: 'O001',
    Quantity: 2,
    UnitPrice: 100,
    RevnAmount: 200,
  },
  teamMember: { OptyResourceId: 123, OptyNumber: 'O001', ResourceId: 456, PartyName: 'Owner' },
  assignee: { ActivityAssigneeId: 123, AssigneeId: 456, ActyActivityNumber: 'ACT001' },
  activityContact: { ActivityContactId: 123, ContactId: 456, ActyActivityNumber: 'ACT001' },
}

// Each row is the published CRM 11.13.18.05 endpoint contract, independent of runtime metadata.
const REQUESTS: Array<{
  operation: string
  input: Record<string, unknown>
  method: string
  path: string
  body?: Record<string, unknown>
  entity: string
  collection: string
  key: string
  kind: string
}> = [
  {
    operation: 'accept_lead',
    input: { leadId: '123' },
    method: 'POST',
    path: 'leads/action/acceptLead',
    body: { leadId: 123 },
    entity: 'lead',
    collection: 'leads',
    key: 'LEAD-OPAQUE',
    kind: 'action',
  },
  {
    operation: 'add_activity_assignee',
    input: { activityNumber: 'ACT001', ownerId: '123' },
    method: 'POST',
    path: 'activities/ACT001/child/ActivityAssignee',
    body: { AssigneeId: 123 },
    entity: 'assignee',
    collection: 'activities/ACT001/child/ActivityAssignee',
    key: 'ASSIGNEE-OPAQUE',
    kind: 'create',
  },
  {
    operation: 'add_activity_contact',
    input: { activityNumber: 'ACT001', contactId: '123' },
    method: 'POST',
    path: 'activities/ACT001/child/ActivityContact',
    body: { ContactId: 123 },
    entity: 'activityContact',
    collection: 'activities/ACT001/child/ActivityContact',
    key: 'CONTACT-OPAQUE',
    kind: 'create',
  },
  {
    operation: 'add_opportunity_contact',
    input: { opportunityNumber: 'O001', contactId: '123' },
    method: 'POST',
    path: 'opportunities/O001/child/OpportunityContact',
    body: { PERPartyId: 123 },
    entity: 'opportunityContact',
    collection: 'opportunities/O001/child/OpportunityContact',
    key: '123',
    kind: 'create',
  },
  {
    operation: 'add_opportunity_team_member',
    input: { opportunityNumber: 'O001', ownerId: '123' },
    method: 'POST',
    path: 'opportunities/O001/child/OpportunityResource',
    body: { ResourceId: 123 },
    entity: 'teamMember',
    collection: 'opportunities/O001/child/OpportunityResource',
    key: 'TEAM-OPAQUE',
    kind: 'create',
  },
  {
    operation: 'assign_account',
    input: { accountNumber: 'A001' },
    method: 'POST',
    path: 'accounts/action/runAssignment',
    body: { partyNumber: 'A001' },
    entity: 'account',
    collection: 'accounts',
    key: 'A001',
    kind: 'action',
  },
  {
    operation: 'assign_lead',
    input: { leadId: '123' },
    method: 'POST',
    path: 'leads/action/runAssignment',
    body: { leadId: 123 },
    entity: 'lead',
    collection: 'leads',
    key: 'LEAD-OPAQUE',
    kind: 'action',
  },
  {
    operation: 'assign_opportunity',
    input: { opportunityNumber: 'O001' },
    method: 'POST',
    path: 'opportunities/action/assignOpportunity',
    body: { optyNumber: 'O001' },
    entity: 'opportunity',
    collection: 'opportunities',
    key: 'O001',
    kind: 'action',
  },
  {
    operation: 'convert_lead',
    input: { leadId: '123', opportunityName: 'Qualified', opportunityOwnerNumber: 'R001' },
    method: 'POST',
    path: 'leads/action/convertLeadToOpty',
    body: { leadId: 123, opportunityName: 'Qualified', opportunityOwnerNumber: 'R001' },
    entity: 'lead',
    collection: 'leads',
    key: 'LEAD-OPAQUE',
    kind: 'action',
  },
  {
    operation: 'create_account',
    input: { organizationName: 'Example' },
    method: 'POST',
    path: 'accounts',
    body: { OrganizationName: 'Example' },
    entity: 'account',
    collection: 'accounts',
    key: 'A001',
    kind: 'create',
  },
  {
    operation: 'create_appointment',
    input: {
      subject: 'Example',
      startDateTime: '2026-09-01T12:00:00Z',
      endDateTime: '2026-09-01T13:00:00Z',
      description: 'Plain description',
      meetingMinutes: 'Agreed next steps',
    },
    method: 'POST',
    path: 'activities',
    body: {
      Subject: 'Example',
      ActivityDescription: 'Plain description',
      ActivityMtgMinutes: 'Agreed next steps',
      ActivityStartDate: '2026-09-01T12:00:00Z',
      ActivityEndDate: '2026-09-01T13:00:00Z',
      ActivityFunctionCode: 'APPOINTMENT',
    },
    entity: 'activity',
    collection: 'activities',
    key: 'ACT001',
    kind: 'create',
  },
  {
    operation: 'create_call_report',
    input: {
      subject: 'Example',
      startDateTime: '2026-09-01T12:00:00Z',
      endDateTime: '2026-09-01T13:00:00Z',
      description: 'Plain description',
      meetingMinutes: 'Agreed next steps',
    },
    method: 'POST',
    path: 'activities',
    body: {
      Subject: 'Example',
      ActivityDescription: 'Plain description',
      ActivityMtgMinutes: 'Agreed next steps',
      ActivityStartDate: '2026-09-01T12:00:00Z',
      ActivityEndDate: '2026-09-01T13:00:00Z',
      ActivityFunctionCode: 'CALLREPORT',
    },
    entity: 'activity',
    collection: 'activities',
    key: 'ACT001',
    kind: 'create',
  },
  {
    operation: 'create_contact',
    input: { lastName: 'Example' },
    method: 'POST',
    path: 'contacts',
    body: { LastName: 'Example' },
    entity: 'contact',
    collection: 'contacts',
    key: 'C001',
    kind: 'create',
  },
  {
    operation: 'create_lead',
    input: { name: 'Example' },
    method: 'POST',
    path: 'leads',
    body: { Name: 'Example' },
    entity: 'lead',
    collection: 'leads',
    key: 'LEAD-OPAQUE',
    kind: 'create',
  },
  {
    operation: 'create_opportunity',
    input: { name: 'Example' },
    method: 'POST',
    path: 'opportunities',
    body: { Name: 'Example' },
    entity: 'opportunity',
    collection: 'opportunities',
    key: 'O001',
    kind: 'create',
  },
  {
    operation: 'create_opportunity_revenue',
    input: { opportunityNumber: 'O001', productGroupId: '123', quantity: 2, unitPrice: 100 },
    method: 'POST',
    path: 'opportunities/O001/child/ChildRevenue',
    body: { ProdGroupId: 123, Quantity: 2, UnitPrice: 100 },
    entity: 'revenue',
    collection: 'opportunities/O001/child/ChildRevenue',
    key: 'REVENUE-OPAQUE',
    kind: 'create',
  },
  {
    operation: 'create_task',
    input: {
      subject: 'Example',
      description: 'Plain description',
      meetingMinutes: 'Agreed next steps',
    },
    method: 'POST',
    path: 'activities',
    body: {
      Subject: 'Example',
      ActivityDescription: 'Plain description',
      ActivityMtgMinutes: 'Agreed next steps',
      ActivityFunctionCode: 'TASK',
    },
    entity: 'activity',
    collection: 'activities',
    key: 'ACT001',
    kind: 'create',
  },
  {
    operation: 'delete_account',
    input: { accountNumber: 'A001' },
    method: 'DELETE',
    path: 'accounts/A001',
    entity: 'account',
    collection: 'accounts',
    key: 'A001',
    kind: 'delete',
  },
  {
    operation: 'delete_activity',
    input: { activityNumber: 'ACT001' },
    method: 'DELETE',
    path: 'activities/ACT001',
    entity: 'activity',
    collection: 'activities',
    key: 'ACT001',
    kind: 'delete',
  },
  {
    operation: 'delete_contact',
    input: { contactNumber: 'C001' },
    method: 'DELETE',
    path: 'contacts/C001',
    entity: 'contact',
    collection: 'contacts',
    key: 'C001',
    kind: 'delete',
  },
  {
    operation: 'delete_lead',
    input: { leadKey: 'LEAD-OPAQUE' },
    method: 'DELETE',
    path: 'leads/LEAD-OPAQUE',
    entity: 'lead',
    collection: 'leads',
    key: 'LEAD-OPAQUE',
    kind: 'delete',
  },
  {
    operation: 'delete_opportunity',
    input: { opportunityNumber: 'O001' },
    method: 'DELETE',
    path: 'opportunities/O001',
    entity: 'opportunity',
    collection: 'opportunities',
    key: 'O001',
    kind: 'delete',
  },
  {
    operation: 'delete_opportunity_revenue',
    input: { opportunityNumber: 'O001', revenueKey: 'REVENUE-OPAQUE' },
    method: 'DELETE',
    path: 'opportunities/O001/child/ChildRevenue/REVENUE-OPAQUE',
    entity: 'revenue',
    collection: 'opportunities/O001/child/ChildRevenue',
    key: 'REVENUE-OPAQUE',
    kind: 'delete',
  },
  {
    operation: 'find_duplicate_accounts',
    input: { matchingFields: { OrganizationName: 'Example' } },
    method: 'POST',
    path: 'accounts/action/findDuplicates',
    body: { account: { OrganizationName: 'Example' } },
    entity: 'account',
    collection: 'accounts',
    key: 'A001',
    kind: 'duplicates',
  },
  {
    operation: 'find_duplicate_contacts',
    input: { matchingFields: { LastName: 'Example' }, accountNumber: 'A001' },
    method: 'POST',
    path: 'contacts/action/findDuplicates',
    body: { contact: { LastName: 'Example' }, accountPartyNumber: 'A001' },
    entity: 'contact',
    collection: 'contacts',
    key: 'C001',
    kind: 'duplicates',
  },
  {
    operation: 'get_account',
    input: { accountNumber: 'A001' },
    method: 'GET',
    path: 'accounts/A001',
    entity: 'account',
    collection: 'accounts',
    key: 'A001',
    kind: 'get',
  },
  {
    operation: 'get_activity',
    input: { activityNumber: 'ACT001' },
    method: 'GET',
    path: 'activities/ACT001',
    entity: 'activity',
    collection: 'activities',
    key: 'ACT001',
    kind: 'get',
  },
  {
    operation: 'get_contact',
    input: { contactNumber: 'C001' },
    method: 'GET',
    path: 'contacts/C001',
    entity: 'contact',
    collection: 'contacts',
    key: 'C001',
    kind: 'get',
  },
  {
    operation: 'get_lead',
    input: { leadKey: 'LEAD-OPAQUE' },
    method: 'GET',
    path: 'leads/LEAD-OPAQUE',
    entity: 'lead',
    collection: 'leads',
    key: 'LEAD-OPAQUE',
    kind: 'get',
  },
  {
    operation: 'get_opportunity',
    input: { opportunityNumber: 'O001' },
    method: 'GET',
    path: 'opportunities/O001',
    entity: 'opportunity',
    collection: 'opportunities',
    key: 'O001',
    kind: 'get',
  },
  {
    operation: 'get_sales_resource',
    input: { resourceNumber: 'R001' },
    method: 'GET',
    path: 'resources/R001',
    entity: 'resource',
    collection: 'resources',
    key: 'R001',
    kind: 'get',
  },
  {
    operation: 'list_accounts',
    input: { limit: 25, offset: 0 },
    method: 'GET',
    path: 'accounts',
    entity: 'account',
    collection: 'accounts',
    key: 'A001',
    kind: 'list',
  },
  {
    operation: 'list_activities',
    input: { limit: 25, offset: 0 },
    method: 'GET',
    path: 'activities',
    entity: 'activity',
    collection: 'activities',
    key: 'ACT001',
    kind: 'list',
  },
  {
    operation: 'list_activity_assignees',
    input: { activityNumber: 'ACT001', limit: 25, offset: 0 },
    method: 'GET',
    path: 'activities/ACT001/child/ActivityAssignee',
    entity: 'assignee',
    collection: 'activities/ACT001/child/ActivityAssignee',
    key: 'ASSIGNEE-OPAQUE',
    kind: 'list',
  },
  {
    operation: 'list_activity_contacts',
    input: { activityNumber: 'ACT001', limit: 25, offset: 0 },
    method: 'GET',
    path: 'activities/ACT001/child/ActivityContact',
    entity: 'activityContact',
    collection: 'activities/ACT001/child/ActivityContact',
    key: 'CONTACT-OPAQUE',
    kind: 'list',
  },
  {
    operation: 'list_contacts',
    input: { limit: 25, offset: 0 },
    method: 'GET',
    path: 'contacts',
    entity: 'contact',
    collection: 'contacts',
    key: 'C001',
    kind: 'list',
  },
  {
    operation: 'list_leads',
    input: { limit: 25, offset: 0 },
    method: 'GET',
    path: 'leads',
    entity: 'lead',
    collection: 'leads',
    key: 'LEAD-OPAQUE',
    kind: 'list',
  },
  {
    operation: 'list_opportunities',
    input: { limit: 25, offset: 0 },
    method: 'GET',
    path: 'opportunities',
    entity: 'opportunity',
    collection: 'opportunities',
    key: 'O001',
    kind: 'list',
  },
  {
    operation: 'list_opportunity_contacts',
    input: { opportunityNumber: 'O001', limit: 25, offset: 0 },
    method: 'GET',
    path: 'opportunities/O001/child/OpportunityContact',
    entity: 'opportunityContact',
    collection: 'opportunities/O001/child/OpportunityContact',
    key: '123',
    kind: 'list',
  },
  {
    operation: 'list_opportunity_revenue',
    input: { opportunityNumber: 'O001', limit: 25, offset: 0 },
    method: 'GET',
    path: 'opportunities/O001/child/ChildRevenue',
    entity: 'revenue',
    collection: 'opportunities/O001/child/ChildRevenue',
    key: 'REVENUE-OPAQUE',
    kind: 'list',
  },
  {
    operation: 'list_opportunity_team',
    input: { opportunityNumber: 'O001', limit: 25, offset: 0 },
    method: 'GET',
    path: 'opportunities/O001/child/OpportunityResource',
    entity: 'teamMember',
    collection: 'opportunities/O001/child/OpportunityResource',
    key: 'TEAM-OPAQUE',
    kind: 'list',
  },
  {
    operation: 'list_sales_resources',
    input: { limit: 25, offset: 0 },
    method: 'GET',
    path: 'resources',
    entity: 'resource',
    collection: 'resources',
    key: 'R001',
    kind: 'list',
  },
  {
    operation: 'reject_lead',
    input: { leadId: '123', reason: 'TENANT_REASON', comments: 'Reviewed' },
    method: 'POST',
    path: 'leads/action/rejectLead',
    body: { leadId: 123, reason: 'TENANT_REASON', comments: 'Reviewed' },
    entity: 'lead',
    collection: 'leads',
    key: 'LEAD-OPAQUE',
    kind: 'action',
  },
  {
    operation: 'remove_activity_assignee',
    input: { activityNumber: 'ACT001', assigneeKey: 'ASSIGNEE-OPAQUE' },
    method: 'DELETE',
    path: 'activities/ACT001/child/ActivityAssignee/ASSIGNEE-OPAQUE',
    entity: 'assignee',
    collection: 'activities/ACT001/child/ActivityAssignee',
    key: 'ASSIGNEE-OPAQUE',
    kind: 'delete',
  },
  {
    operation: 'remove_activity_contact',
    input: { activityNumber: 'ACT001', activityContactKey: 'CONTACT-OPAQUE' },
    method: 'DELETE',
    path: 'activities/ACT001/child/ActivityContact/CONTACT-OPAQUE',
    entity: 'activityContact',
    collection: 'activities/ACT001/child/ActivityContact',
    key: 'CONTACT-OPAQUE',
    kind: 'delete',
  },
  {
    operation: 'remove_opportunity_contact',
    input: { opportunityNumber: 'O001', opportunityContactId: '123' },
    method: 'DELETE',
    path: 'opportunities/O001/child/OpportunityContact/123',
    entity: 'opportunityContact',
    collection: 'opportunities/O001/child/OpportunityContact',
    key: '123',
    kind: 'delete',
  },
  {
    operation: 'remove_opportunity_team_member',
    input: { opportunityNumber: 'O001', teamMemberKey: 'TEAM-OPAQUE' },
    method: 'DELETE',
    path: 'opportunities/O001/child/OpportunityResource/TEAM-OPAQUE',
    entity: 'teamMember',
    collection: 'opportunities/O001/child/OpportunityResource',
    key: 'TEAM-OPAQUE',
    kind: 'delete',
  },
  {
    operation: 'update_account',
    input: { accountNumber: 'A001', organizationName: 'Updated' },
    method: 'PATCH',
    path: 'accounts/A001',
    body: { OrganizationName: 'Updated' },
    entity: 'account',
    collection: 'accounts',
    key: 'A001',
    kind: 'update',
  },
  {
    operation: 'update_activity',
    input: { activityNumber: 'ACT001', subject: 'Updated' },
    method: 'PATCH',
    path: 'activities/ACT001',
    body: { Subject: 'Updated' },
    entity: 'activity',
    collection: 'activities',
    key: 'ACT001',
    kind: 'update',
  },
  {
    operation: 'update_contact',
    input: { contactNumber: 'C001', firstName: 'Updated' },
    method: 'PATCH',
    path: 'contacts/C001',
    body: { FirstName: 'Updated' },
    entity: 'contact',
    collection: 'contacts',
    key: 'C001',
    kind: 'update',
  },
  {
    operation: 'update_lead',
    input: { leadKey: 'LEAD-OPAQUE', name: 'Updated' },
    method: 'PATCH',
    path: 'leads/LEAD-OPAQUE',
    body: { Name: 'Updated' },
    entity: 'lead',
    collection: 'leads',
    key: 'LEAD-OPAQUE',
    kind: 'update',
  },
  {
    operation: 'update_opportunity',
    input: { opportunityNumber: 'O001', name: 'Updated' },
    method: 'PATCH',
    path: 'opportunities/O001',
    body: { Name: 'Updated' },
    entity: 'opportunity',
    collection: 'opportunities',
    key: 'O001',
    kind: 'update',
  },
  {
    operation: 'update_opportunity_contact',
    input: { opportunityNumber: 'O001', opportunityContactId: '123', contactId: '123' },
    method: 'PATCH',
    path: 'opportunities/O001/child/OpportunityContact/123',
    body: { PERPartyId: 123 },
    entity: 'opportunityContact',
    collection: 'opportunities/O001/child/OpportunityContact',
    key: '123',
    kind: 'update',
  },
  {
    operation: 'update_opportunity_revenue',
    input: { opportunityNumber: 'O001', revenueKey: 'REVENUE-OPAQUE', productGroupId: '123' },
    method: 'PATCH',
    path: 'opportunities/O001/child/ChildRevenue/REVENUE-OPAQUE',
    body: { ProdGroupId: 123 },
    entity: 'revenue',
    collection: 'opportunities/O001/child/ChildRevenue',
    key: 'REVENUE-OPAQUE',
    kind: 'update',
  },
  {
    operation: 'update_opportunity_team_member',
    input: { opportunityNumber: 'O001', teamMemberKey: 'TEAM-OPAQUE', accessLevelCode: 'Updated' },
    method: 'PATCH',
    path: 'opportunities/O001/child/OpportunityResource/TEAM-OPAQUE',
    body: { AccessLevelCode: 'Updated' },
    entity: 'teamMember',
    collection: 'opportunities/O001/child/OpportunityResource',
    key: 'TEAM-OPAQUE',
    kind: 'update',
  },
]

function record(entity: string, collection: string, key: string, context = true) {
  const links = [{ rel: 'self', href: `${ROOT}/${collection}/${key}` }]
  return {
    ...RECORDS[entity],
    ...(context ? { '@context': { links } } : { links }),
    UnpublishedField: 'do-not-project',
  }
}

describe('Oracle Fusion Sales operation contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.empty.mockResolvedValue(undefined)
  })

  it.each(REQUESTS)(
    '$operation uses its documented method, path, body, and response',
    async (entry) => {
      const item = record(entry.entity, entry.collection, entry.key)
      const response =
        entry.kind === 'list'
          ? { items: [item], count: 1, limit: 25, offset: 0, hasMore: false }
          : entry.kind === 'duplicates'
            ? { result: [{ PartyId: '123', PartyNumber: 'P001', MatchScore: '99.2' }] }
            : entry.kind === 'action'
              ? { result: 'Successful' }
              : item
      mocks.json.mockResolvedValue(response)
      const output = await executeOracleFusionSalesOperation(entry.operation, {
        ...AUTH,
        ...entry.input,
      })
      const request = (entry.method === 'DELETE' ? mocks.empty : mocks.json).mock
        .calls[0][1] as OracleFusionRequest
      expect(request.address).toEqual({ family: 'crm', relativePath: entry.path })
      expect(request.method ?? 'GET').toBe(entry.method)
      if ('body' in request) {
        expect(JSON.parse(serializeOracleFusionJsonBody(request.body))).toEqual(entry.body)
        expect(request.mediaType).toBe(
          entry.kind === 'action' || entry.kind === 'duplicates'
            ? 'application/vnd.oracle.adf.action+json'
            : 'application/vnd.oracle.adf.resourceitem+json'
        )
      } else expect(entry.body).toBeUndefined()
      expect(output.success).toBe(true)
      expect(JSON.stringify(output)).not.toContain('UnpublishedField')
      if (entry.kind === 'list') {
        expect(output.output).toMatchObject({ count: 1, hasMore: false, limit: 25, offset: 0 })
        expect(output.output).not.toHaveProperty('nextOffset')
      }
      if (entry.kind === 'delete') expect(output.output).toEqual({ deleted: true })
      if (entry.kind === 'action') expect(output.output).toEqual({ result: 'Successful' })
    }
  )

  it('preserves exact integers in action and CRUD bodies after JSON-boundary validation', async () => {
    mocks.json.mockResolvedValue({ result: 'Successful' })
    await executeOracleFusionSalesOperation('accept_lead', {
      ...AUTH,
      leadId: '9007199254740993',
    })
    expect(serializeOracleFusionJsonBody(mocks.json.mock.calls[0][1].body)).toBe(
      '{"leadId":9007199254740993}'
    )

    mocks.json.mockResolvedValue(record('account', 'accounts', 'A001'))
    await executeOracleFusionSalesOperation('update_account', {
      ...AUTH,
      accountNumber: 'A001',
      ownerId: '9007199254740993',
      description: null,
    })
    const body = serializeOracleFusionJsonBody(mocks.json.mock.calls[1][1].body)
    expect(body).toContain('"OwnerPartyId":9007199254740993')
    expect(body).toContain('"Description":null')
    expect(body).not.toContain('EmailAddress')
  })

  it('does not replace an opaque lead key with the business LeadId', async () => {
    mocks.json.mockResolvedValue({
      ...record('lead', 'leads', 'LEAD-OPAQUE'),
      LeadId: '9007199254740993',
    })
    const result = await executeOracleFusionSalesOperation('get_lead', {
      ...AUTH,
      leadKey: 'LEAD-OPAQUE',
    })
    expect(result.output.record).toMatchObject({
      resourceKey: 'LEAD-OPAQUE',
      LeadId: '9007199254740993',
    })
    expect(mocks.json.mock.calls[0][1].address.relativePath).toBe('leads/LEAD-OPAQUE')
  })

  it('preserves framework-9 decimal strings on creates, updates, and lists', async () => {
    const amount = '123456789012345.123456789'
    const row = { ...record('opportunity', 'opportunities', 'O001'), Revenue: amount }
    for (const [operation, input] of [
      ['create_opportunity', { name: 'Renewal' }],
      ['update_opportunity', { opportunityNumber: 'O001', name: 'Renewal' }],
    ] as const) {
      mocks.json.mockResolvedValue(row)
      const result = await executeOracleFusionSalesOperation(operation, { ...AUTH, ...input })
      expect(result.output.record?.Revenue).toBe(amount)
    }
    mocks.json.mockResolvedValue({
      items: [row],
      count: 1,
      offset: 0,
      limit: 50,
      hasMore: false,
    })
    const page = await listOracleFusionSalesRecords('opportunity', AUTH)
    expect(page.items[0].Revenue).toBe(amount)
    for (const invalid of ['NaN', ' 123 ', '1.0\n', true, {}]) {
      mocks.json.mockResolvedValue({ ...row, Revenue: invalid })
      await expect(
        executeOracleFusionSalesOperation('get_opportunity', {
          ...AUTH,
          opportunityNumber: 'O001',
        })
      ).rejects.toThrow('invalid record data')
    }
  })

  it('canonicalizes exact exponent-form Oracle identifiers without rounding', async () => {
    mocks.json.mockResolvedValue({
      ...record('lead', 'leads', 'LEAD-OPAQUE'),
      LeadId: '9.007199254740993e15',
    })
    const result = await executeOracleFusionSalesOperation('get_lead', {
      ...AUTH,
      leadKey: 'LEAD-OPAQUE',
    })
    expect(result.output.record?.LeadId).toBe('9007199254740993')
  })

  it('accepts legacy and framework-9 self links but rejects a different origin or record', async () => {
    for (const context of [true, false]) {
      mocks.json.mockResolvedValue(record('account', 'accounts', 'A001', context))
      await expect(
        executeOracleFusionSalesOperation('get_account', {
          ...AUTH,
          accountNumber: 'A001',
        })
      ).resolves.toMatchObject({ success: true })
    }
    mocks.json.mockResolvedValue({
      ...RECORDS.account,
      '@context': {
        links: [
          {
            rel: 'self',
            href: 'https://other.fa.us2.oraclecloud.com/crmRestApi/resources/11.13.18.05/accounts/A001',
          },
        ],
      },
    })
    await expect(
      executeOracleFusionSalesOperation('get_account', {
        ...AUTH,
        accountNumber: 'A001',
      })
    ).rejects.toThrow()
    mocks.json.mockResolvedValue(record('account', 'accounts', 'A001'))
    await expect(
      executeOracleFusionSalesOperation('get_account', {
        ...AUTH,
        accountNumber: 'A002',
      })
    ).rejects.toThrow()
  })

  it('returns one bounded page with correct continuation, query, and cancellation propagation', async () => {
    const signal = new AbortController().signal
    mocks.json.mockResolvedValue({
      items: [record('account', 'accounts', 'A001')],
      count: 1,
      offset: 25,
      limit: 25,
      hasMore: true,
      totalResults: 27,
    })
    const result = await listOracleFusionSalesRecords(
      'account',
      {
        ...AUTH,
        limit: 25,
        offset: 25,
        totalResults: true,
        q: "OrganizationName LIKE 'Example%'",
        orderBy: 'PartyId:asc',
      },
      signal
    )
    expect(result).toMatchObject({ nextOffset: 26, hasMore: true, totalResults: 27 })
    expect(mocks.json).toHaveBeenCalledTimes(1)
    expect(mocks.json.mock.calls[0][1].query).toMatchObject({
      limit: 25,
      offset: 25,
      q: "OrganizationName LIKE 'Example%'",
      orderBy: 'PartyId:asc',
    })
    expect(mocks.json.mock.calls[0][2]).toBe(signal)
  })

  it('handles an empty final page and rejects contradictory envelopes', async () => {
    mocks.json.mockResolvedValue({ items: [], count: 0, limit: 50, offset: 0, hasMore: false })
    const empty = await listOracleFusionSalesRecords('lead', AUTH)
    expect(empty.items).toEqual([])
    expect(empty).not.toHaveProperty('nextOffset')

    for (const page of [
      { items: [], count: 0, limit: 50, offset: 0, hasMore: true },
      { items: [], count: 1, limit: 50, offset: 0, hasMore: false },
      { items: [], count: 0, limit: 50, offset: 10, hasMore: false },
    ]) {
      mocks.json.mockResolvedValue(page)
      await expect(listOracleFusionSalesRecords('lead', AUTH)).rejects.toThrow()
    }
  })

  it('rejects oversized duplicate candidate results before projection rather than truncating', async () => {
    mocks.json.mockResolvedValue({ result: Array.from({ length: 1001 }, () => ({})) })
    await expect(
      executeOracleFusionSalesOperation('find_duplicate_accounts', {
        ...AUTH,
        matchingFields: { OrganizationName: 'Example' },
      })
    ).rejects.toThrow('more than 1,000 duplicate candidates')
  })

  it('does not guess undocumented conversion identifiers or duplicate fields', async () => {
    mocks.json.mockResolvedValue({ result: 'Successful', OptyId: 999 })
    expect(
      (
        await executeOracleFusionSalesOperation('convert_lead', {
          ...AUTH,
          leadId: '123',
        })
      ).output
    ).toEqual({ result: 'Successful' })
    mocks.json.mockResolvedValue({
      result: [{ PartyId: '123', MatchScore: '98', HiddenCustom: 'hidden' }],
    })
    const duplicates = await executeOracleFusionSalesOperation('find_duplicate_accounts', {
      ...AUTH,
      matchingFields: { OrganizationName: 'Example' },
    })
    expect(duplicates.output.items?.[0]).toMatchObject({ PartyId: '123', MatchScore: '98' })
    expect(duplicates.output.items?.[0]).not.toHaveProperty('HiddenCustom')
  })
})
