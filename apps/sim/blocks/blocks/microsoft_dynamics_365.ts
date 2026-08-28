import { MicrosoftDataverseIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import {
  parseOptionalBooleanInput,
  parseOptionalJsonInput,
  parseOptionalNumberInput,
} from '@/blocks/utils'
import type { DataverseResponse } from '@/tools/microsoft_dynamics_365/types'

const DATAVERSE_GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const CRM_RECORD_TYPES = {
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

const OWNER_TYPES = {
  user: {
    entitySetName: 'systemusers',
    select: 'systemuserid,fullname,domainname,internalemailaddress,isdisabled',
    filter: 'isdisabled eq false',
  },
  team: {
    entitySetName: 'teams',
    select: 'teamid,name,teamtype',
    filter: 'teamtype ne 1',
  },
} as const

type CrmRecordType = keyof typeof CRM_RECORD_TYPES
type OwnerType = keyof typeof OWNER_TYPES

function normalizeDataverseGuid(value: string, fieldName: string): string {
  const trimmed = value.trim()
  const hasOpeningBrace = trimmed.startsWith('{')
  const hasClosingBrace = trimmed.endsWith('}')
  if (hasOpeningBrace !== hasClosingBrace) {
    throw new Error(`${fieldName} must be a valid GUID`)
  }

  const normalized = hasOpeningBrace ? trimmed.slice(1, -1) : trimmed
  if (!DATAVERSE_GUID_PATTERN.test(normalized)) {
    throw new Error(`${fieldName} must be a valid GUID`)
  }
  return normalized
}

function requiredString(value: unknown, label: string, maxLength?: number): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} is required.`)
  }
  const trimmed = value.trim()
  if (maxLength !== undefined && trimmed.length > maxLength) {
    throw new Error(`${label} must be at most ${maxLength} characters.`)
  }
  return trimmed
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function optionalOpaqueString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function optionalBoundedString(
  value: unknown,
  label: string,
  maxLength: number
): string | undefined {
  const normalized = optionalString(value)
  if (normalized !== undefined && normalized.length > maxLength) {
    throw new Error(`${label} must be at most ${maxLength} characters.`)
  }
  return normalized
}

function getListPaginationParams(params: Record<string, unknown>) {
  const pageSize = parseOptionalNumberInput(params.maxResults, 'Max results', {
    integer: true,
    min: 1,
    max: 100,
  })
  const nextLink = optionalOpaqueString(params.nextLink)
  const nextPageSize = parseOptionalNumberInput(params.nextPageSize, 'Next page size', {
    integer: true,
    min: 1,
    max: 100,
  })

  if (nextLink !== undefined) {
    if (nextPageSize === undefined) {
      throw new Error('Next page size is required when Next Page URL is provided.')
    }
    if (pageSize !== undefined && pageSize !== nextPageSize) {
      throw new Error('Max results must match Next page size.')
    }
    return {
      nextLink,
      nextPageSize,
      ...(pageSize !== undefined && { pageSize }),
    }
  }

  if (nextPageSize !== undefined) {
    throw new Error('Next page size may only be provided with Next Page URL.')
  }
  return { pageSize: pageSize ?? 100 }
}

function parseRequiredRecord(value: unknown): Record<string, unknown> {
  const parsed = parseOptionalJsonInput<unknown>(value, 'Record data')
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Record data must be a JSON object.')
  }
  return parsed as Record<string, unknown>
}

function parseBooleanWithDefault(value: unknown, label: string, defaultValue: boolean): boolean {
  if (value === undefined || value === null || value === '') return defaultValue
  if (typeof value === 'number' && value !== 0 && value !== 1) {
    throw new Error(`${label} must be true or false.`)
  }
  const parsed = parseOptionalBooleanInput(value)
  if (parsed === undefined) throw new Error(`${label} must be true or false.`)
  return parsed
}

function getRecordType(value: unknown) {
  const recordType = requiredString(value, 'Record type')
  if (!Object.hasOwn(CRM_RECORD_TYPES, recordType)) {
    throw new Error(`Unsupported Dynamics 365 record type: ${recordType}`)
  }
  return CRM_RECORD_TYPES[recordType as CrmRecordType]
}

function getOwnerType(value: unknown) {
  const ownerType = requiredString(value, 'Owner type')
  if (!Object.hasOwn(OWNER_TYPES, ownerType)) {
    throw new Error(`Unsupported Dynamics 365 owner type: ${ownerType}`)
  }
  return OWNER_TYPES[ownerType as OwnerType]
}

function getCommonParams(params: Record<string, unknown>) {
  return {
    credential: requiredString(params.credential, 'Microsoft account'),
    environmentUrl: requiredString(params.environmentUrl, 'Environment URL'),
  }
}

export const MicrosoftDynamics365Block: BlockConfig<DataverseResponse> = {
  type: 'microsoft_dynamics_365',
  name: 'Microsoft Dynamics 365 CRM',
  description: 'Manage customers, sales pipelines, and support cases in Dynamics 365 CRM',
  authMode: AuthMode.OAuth,
  longDescription:
    'Manage standard Microsoft Dynamics 365 CRM records through the Dataverse Web API. List, search, create, retrieve, and update accounts, contacts, leads, opportunities, and cases; assign records to users or teams; qualify leads; close opportunities; and resolve cases. Connect a separate Microsoft credential for each environment from this Dynamics integration page or from its workflow block; existing generic Dataverse credentials remain unchanged and are not automatically rebound. This version supports public-cloud Dynamics environments; national clouds require separate OAuth authorities. Dataverse Search must be enabled for search, and lifecycle actions require the corresponding Dynamics 365 app, security role, and record privileges.',
  docsLink: 'https://docs.sim.ai/integrations/microsoft_dynamics_365',
  category: 'tools',
  integrationType: IntegrationType.Sales,
  bgColor: '#FFFFFF',
  icon: MicrosoftDataverseIcon,
  canvasPresentation: {
    defaultTitle: 'Microsoft Dynamics 365 CRM',
    sentences: {
      byOperation: {
        list_records: ['List CRM records', { text: 'of type', field: 'recordType' }],
        get_record: [
          { text: 'Read', field: 'recordId', core: true },
          { text: 'from', field: 'recordType', core: true },
        ],
        create_record: [{ text: 'Create', field: 'recordType', core: true }],
        update_record: [
          { text: 'Update', field: 'recordId', core: true },
          { text: 'in', field: 'recordType', core: true },
        ],
        search_records: [
          { text: 'Search', field: 'recordType', core: true },
          { text: 'for', field: 'searchTerm', core: true },
        ],
        list_owners: ['List CRM owners', { text: 'of type', field: 'ownerType' }],
        assign_record: [
          { text: 'Assign', field: 'recordId', core: true },
          { text: 'in', field: 'recordType', core: true },
          { text: 'to', field: 'ownerId', core: true },
        ],
        qualify_lead: [{ text: 'Qualify lead', field: 'leadId', core: true }],
        close_opportunity: [
          { text: 'Close opportunity', field: 'closeOpportunityId', core: true },
          { text: 'as', field: 'opportunityOutcome', core: true },
        ],
        close_case: [{ text: 'Resolve case', field: 'caseId', core: true }],
      },
    },
  },
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'List Records', id: 'list_records' },
        { label: 'Get Record', id: 'get_record' },
        { label: 'Create Record', id: 'create_record' },
        { label: 'Update Record', id: 'update_record' },
        { label: 'Search Records', id: 'search_records' },
        { label: 'List Owners', id: 'list_owners' },
        { label: 'Assign Record', id: 'assign_record' },
        { label: 'Qualify Lead', id: 'qualify_lead' },
        { label: 'Close Opportunity', id: 'close_opportunity' },
        { label: 'Close Case', id: 'close_case' },
      ],
      value: () => 'list_records',
    },
    {
      id: 'environmentUrl',
      title: 'Environment URL',
      type: 'short-input',
      placeholder: 'https://myorg.crm.dynamics.com',
      description:
        'Public-cloud Dynamics environment root URL. National-cloud environments require a separate OAuth configuration.',
      paramVisibility: 'user-only',
      required: true,
    },
    {
      id: 'credential',
      title: 'Microsoft Account',
      type: 'oauth-input',
      serviceId: 'microsoft-dataverse',
      requiredScopes: getScopesForService('microsoft-dataverse'),
      dependsOn: ['environmentUrl'],
      placeholder: 'Select Microsoft account for this environment',
      paramVisibility: 'user-only',
      required: true,
    },
    {
      id: 'recordType',
      title: 'Record Type',
      type: 'dropdown',
      options: [
        { label: 'Account', id: 'account' },
        { label: 'Contact', id: 'contact' },
        { label: 'Lead', id: 'lead' },
        { label: 'Opportunity', id: 'opportunity' },
        { label: 'Case', id: 'case' },
      ],
      value: () => 'account',
      condition: {
        field: 'operation',
        value: [
          'list_records',
          'get_record',
          'create_record',
          'update_record',
          'search_records',
          'assign_record',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'list_records',
          'get_record',
          'create_record',
          'update_record',
          'search_records',
          'assign_record',
        ],
      },
    },
    {
      id: 'recordId',
      title: 'Record ID',
      type: 'short-input',
      placeholder: '00000000-0000-0000-0000-000000000000',
      condition: { field: 'operation', value: ['get_record', 'update_record', 'assign_record'] },
      required: { field: 'operation', value: ['get_record', 'update_record', 'assign_record'] },
    },
    {
      id: 'data',
      title: 'Record Data',
      type: 'long-input',
      placeholder: '{"name":"Contoso","telephone1":"555-0100"}',
      condition: { field: 'operation', value: ['create_record', 'update_record'] },
      required: { field: 'operation', value: ['create_record', 'update_record'] },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON object for a Dynamics 365 Dataverse record. Use logical column names and preserve any custom column names supplied by the user. Return ONLY valid JSON - no explanations, no extra text.',
        placeholder: 'Describe the CRM fields to create or update...',
        generationType: 'json-object',
      },
    },
    {
      id: 'listSelect',
      title: 'Select Columns',
      type: 'short-input',
      placeholder: 'name,telephone1,emailaddress1',
      condition: { field: 'operation', value: ['list_records', 'get_record'] },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a comma-separated list of Dynamics 365 Dataverse logical column names, for example name,telephone1,emailaddress1. Return ONLY the comma-separated names - no explanations, no extra text.',
        placeholder: 'Describe the columns to retrieve...',
        generationType: 'odata-expression',
      },
    },
    {
      id: 'listFilter',
      title: 'Filter',
      type: 'short-input',
      placeholder: "statecode eq 0 and contains(name,'Contoso')",
      condition: { field: 'operation', value: 'list_records' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          "Generate a Dataverse OData $filter expression using logical column names, for example statecode eq 0 and contains(name,'Contoso'). Return ONLY the expression without the $filter= prefix - no explanations, no extra text.",
        placeholder: 'Describe which CRM records to include...',
        generationType: 'odata-expression',
      },
    },
    {
      id: 'listOrderBy',
      title: 'Order By',
      type: 'short-input',
      placeholder: 'createdon desc',
      condition: { field: 'operation', value: 'list_records' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a Dataverse OData $orderby expression using logical column names, for example createdon desc,name asc. Return ONLY the expression without the $orderby= prefix - no explanations, no extra text.',
        placeholder: 'Describe how to sort the records...',
        generationType: 'odata-expression',
      },
    },
    {
      id: 'recordExpand',
      title: 'Expand Relationships',
      type: 'short-input',
      placeholder: 'primarycontactid($select=fullname,emailaddress1)',
      condition: { field: 'operation', value: ['list_records', 'get_record'] },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a Dataverse OData $expand expression for the requested relationships, for example primarycontactid($select=fullname,emailaddress1). Return ONLY the expression without the $expand= prefix - no explanations, no extra text.',
        placeholder: 'Describe which related records to include...',
        generationType: 'odata-expression',
      },
    },
    {
      id: 'maxResults',
      title: 'Max Results',
      type: 'short-input',
      placeholder: '1-100',
      condition: {
        field: 'operation',
        value: ['list_records', 'search_records', 'list_owners'],
      },
      mode: 'advanced',
    },
    {
      id: 'includeCount',
      title: 'Include Total Count',
      type: 'switch',
      defaultValue: false,
      condition: { field: 'operation', value: 'list_records' },
      mode: 'advanced',
    },
    {
      id: 'nextLink',
      title: 'Next Page URL',
      type: 'long-input',
      placeholder: 'Use the nextLink output from the previous page',
      description:
        'Exact continuation URL returned by a previous List Records or List Owners result.',
      condition: { field: 'operation', value: ['list_records', 'list_owners'] },
      mode: 'advanced',
    },
    {
      id: 'nextPageSize',
      title: 'Next Page Size',
      type: 'short-input',
      placeholder: 'Use the nextPageSize output from the previous page',
      description:
        'Exact continuation page size returned with the previous List Records or List Owners result.',
      condition: { field: 'operation', value: ['list_records', 'list_owners'] },
      mode: 'advanced',
    },
    {
      id: 'searchTerm',
      title: 'Search Term',
      type: 'short-input',
      placeholder: 'Customer name, email, company, or case keyword',
      description: 'Requires Dataverse Search to be enabled in the selected environment.',
      condition: { field: 'operation', value: 'search_records' },
      required: { field: 'operation', value: 'search_records' },
    },
    {
      id: 'searchMode',
      title: 'Search Mode',
      type: 'dropdown',
      options: [
        { label: 'Match Any Term', id: 'any' },
        { label: 'Match All Terms', id: 'all' },
      ],
      value: () => 'any',
      condition: { field: 'operation', value: 'search_records' },
      mode: 'advanced',
    },
    {
      id: 'searchFilter',
      title: 'Search Filter',
      type: 'short-input',
      placeholder: 'statecode eq 0',
      description: 'Global OData filter applied to the selected record type.',
      condition: { field: 'operation', value: 'search_records' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a Dataverse Search OData filter using logical column names, for example statecode eq 0 and createdon ge 2024-01-01. Return ONLY the expression - no explanations, no extra text.',
        placeholder: 'Describe which search results to include...',
        generationType: 'odata-expression',
      },
    },
    {
      id: 'searchFacets',
      title: 'Search Facets',
      type: 'long-input',
      placeholder: '["entityname,count:100","ownerid,count:100"]',
      description: 'JSON array of Dataverse Search facet specifications.',
      condition: { field: 'operation', value: 'search_records' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON array of Dataverse Search facet specifications, for example ["entityname,count:100","ownerid,count:100"]. Return ONLY the JSON array - no explanations, no extra text.',
        placeholder: 'Describe how to group the search results...',
        generationType: 'json-array',
      },
    },
    {
      id: 'searchOrderBy',
      title: 'Search Order By',
      type: 'short-input',
      placeholder: '["createdon desc"]',
      description: 'JSON array of Dataverse Search sort expressions.',
      condition: { field: 'operation', value: 'search_records' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON array of Dataverse Search sort expressions using logical column names, for example ["createdon desc"]. Return ONLY the JSON array - no explanations, no extra text.',
        placeholder: 'Describe how to sort the search results...',
        generationType: 'json-array',
      },
    },
    {
      id: 'searchSkip',
      title: 'Search Offset',
      type: 'short-input',
      placeholder: '0',
      description: 'Number of earlier search results to skip.',
      condition: { field: 'operation', value: 'search_records' },
      mode: 'advanced',
    },
    {
      id: 'searchType',
      title: 'Query Type',
      type: 'dropdown',
      options: [
        { label: 'Simple', id: 'simple' },
        { label: 'Lucene', id: 'lucene' },
      ],
      value: () => 'simple',
      condition: { field: 'operation', value: 'search_records' },
      mode: 'advanced',
    },
    {
      id: 'ownerType',
      title: 'Owner Type',
      type: 'dropdown',
      options: [
        { label: 'User', id: 'user' },
        { label: 'Team', id: 'team' },
      ],
      value: () => 'user',
      condition: { field: 'operation', value: ['list_owners', 'assign_record'] },
      required: { field: 'operation', value: ['list_owners', 'assign_record'] },
    },
    {
      id: 'ownerId',
      title: 'Owner ID',
      type: 'short-input',
      placeholder: 'User or team GUID',
      condition: { field: 'operation', value: 'assign_record' },
      required: { field: 'operation', value: 'assign_record' },
    },
    {
      id: 'leadId',
      title: 'Lead ID',
      type: 'short-input',
      placeholder: 'Lead GUID',
      condition: { field: 'operation', value: 'qualify_lead' },
      required: { field: 'operation', value: 'qualify_lead' },
    },
    {
      id: 'createAccount',
      title: 'Create Account',
      type: 'switch',
      defaultValue: true,
      condition: { field: 'operation', value: 'qualify_lead' },
    },
    {
      id: 'createContact',
      title: 'Create Contact',
      type: 'switch',
      defaultValue: true,
      condition: { field: 'operation', value: 'qualify_lead' },
    },
    {
      id: 'createOpportunity',
      title: 'Create Opportunity',
      type: 'switch',
      defaultValue: false,
      condition: { field: 'operation', value: 'qualify_lead' },
    },
    {
      id: 'qualifyStatusReason',
      title: 'Qualified Status Reason',
      type: 'short-input',
      placeholder: 'Defaults to 3',
      condition: { field: 'operation', value: 'qualify_lead' },
      mode: 'advanced',
    },
    {
      id: 'qualifyOpportunityCurrencyId',
      title: 'Opportunity Currency ID',
      type: 'short-input',
      placeholder: 'Transaction currency GUID',
      condition: {
        field: 'operation',
        value: 'qualify_lead',
        and: { field: 'createOpportunity', value: true },
      },
      mode: 'advanced',
    },
    {
      id: 'qualifyOpportunityCustomerId',
      title: 'Opportunity Customer ID',
      type: 'short-input',
      placeholder: 'Account or contact GUID',
      condition: {
        field: 'operation',
        value: 'qualify_lead',
        and: { field: 'createOpportunity', value: true },
      },
      mode: 'advanced',
    },
    {
      id: 'qualifyOpportunityCustomerType',
      title: 'Opportunity Customer Type',
      type: 'dropdown',
      options: [
        { label: 'Account', id: 'account' },
        { label: 'Contact', id: 'contact' },
      ],
      value: () => 'account',
      condition: {
        field: 'operation',
        value: 'qualify_lead',
        and: { field: 'createOpportunity', value: true },
      },
      mode: 'advanced',
    },
    {
      id: 'qualifySourceCampaignId',
      title: 'Source Campaign ID',
      type: 'short-input',
      placeholder: 'Campaign GUID',
      condition: {
        field: 'operation',
        value: 'qualify_lead',
        and: { field: 'createOpportunity', value: true },
      },
      mode: 'advanced',
    },
    {
      id: 'qualifyProcessInstanceId',
      title: 'Process Instance ID',
      type: 'short-input',
      placeholder: 'Business process flow instance GUID',
      condition: {
        field: 'operation',
        value: 'qualify_lead',
        and: { field: 'createOpportunity', value: true },
      },
      mode: 'advanced',
    },
    {
      id: 'qualifyProcessInstanceEntityType',
      title: 'Process Instance Table',
      type: 'short-input',
      placeholder: 'For example: leadtoopportunitysalesprocess',
      condition: {
        field: 'operation',
        value: 'qualify_lead',
        and: { field: 'createOpportunity', value: true },
      },
      mode: 'advanced',
    },
    {
      id: 'closeOpportunityId',
      title: 'Opportunity ID',
      type: 'short-input',
      placeholder: 'Opportunity GUID',
      condition: { field: 'operation', value: 'close_opportunity' },
      required: { field: 'operation', value: 'close_opportunity' },
    },
    {
      id: 'opportunityOutcome',
      title: 'Outcome',
      type: 'dropdown',
      options: [
        { label: 'Won', id: 'won' },
        { label: 'Lost', id: 'lost' },
      ],
      value: () => 'won',
      condition: { field: 'operation', value: 'close_opportunity' },
      required: { field: 'operation', value: 'close_opportunity' },
    },
    {
      id: 'opportunitySubject',
      title: 'Close Subject',
      type: 'short-input',
      placeholder: 'Reason or summary for closing the opportunity',
      description: 'Optional subject for the opportunity-close activity (maximum 200 characters).',
      condition: { field: 'operation', value: 'close_opportunity' },
    },
    {
      id: 'opportunityDescription',
      title: 'Close Notes',
      type: 'long-input',
      placeholder: 'Optional details about the outcome',
      description: 'Optional opportunity-close description (maximum 2,000 characters).',
      condition: { field: 'operation', value: 'close_opportunity' },
      mode: 'advanced',
    },
    {
      id: 'opportunityStatusReason',
      title: 'Status Reason',
      type: 'short-input',
      placeholder: 'Defaults to 3 when won and 4 when lost',
      condition: { field: 'operation', value: 'close_opportunity' },
      mode: 'advanced',
    },
    {
      id: 'caseId',
      title: 'Case ID',
      type: 'short-input',
      placeholder: 'Case GUID',
      condition: { field: 'operation', value: 'close_case' },
      required: { field: 'operation', value: 'close_case' },
    },
    {
      id: 'caseSubject',
      title: 'Resolution Subject',
      type: 'short-input',
      placeholder: 'How the case was resolved',
      condition: { field: 'operation', value: 'close_case' },
      required: { field: 'operation', value: 'close_case' },
    },
    {
      id: 'caseDescription',
      title: 'Resolution Notes',
      type: 'long-input',
      placeholder: 'Optional resolution details',
      description: 'Optional case-resolution description (maximum 100,000 characters).',
      condition: { field: 'operation', value: 'close_case' },
      mode: 'advanced',
    },
    {
      id: 'caseTimeSpent',
      title: 'Time Spent (Minutes)',
      type: 'short-input',
      placeholder: 'Nonnegative whole number',
      condition: { field: 'operation', value: 'close_case' },
      mode: 'advanced',
    },
    {
      id: 'caseStatusReason',
      title: 'Resolved Status Reason',
      type: 'short-input',
      placeholder: 'Defaults to 5',
      condition: { field: 'operation', value: 'close_case' },
      mode: 'advanced',
    },
  ],
  tools: {
    access: [
      'microsoft_dynamics_365_list_records',
      'microsoft_dynamics_365_get_record',
      'microsoft_dynamics_365_create_record',
      'microsoft_dynamics_365_update_record',
      'microsoft_dynamics_365_search_records',
      'microsoft_dynamics_365_qualify_lead',
      'microsoft_dynamics_365_close_opportunity',
      'microsoft_dynamics_365_close_case',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'list_records':
          case 'list_owners':
            return 'microsoft_dynamics_365_list_records'
          case 'get_record':
            return 'microsoft_dynamics_365_get_record'
          case 'create_record':
            return 'microsoft_dynamics_365_create_record'
          case 'update_record':
          case 'assign_record':
            return 'microsoft_dynamics_365_update_record'
          case 'search_records':
            return 'microsoft_dynamics_365_search_records'
          case 'qualify_lead':
            return 'microsoft_dynamics_365_qualify_lead'
          case 'close_opportunity':
            return 'microsoft_dynamics_365_close_opportunity'
          case 'close_case':
            return 'microsoft_dynamics_365_close_case'
          default:
            throw new Error(`Unsupported Dynamics 365 CRM operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const common = getCommonParams(params)

        switch (params.operation) {
          case 'list_records': {
            const recordType = getRecordType(params.recordType)
            const includeCount = parseBooleanWithDefault(
              params.includeCount,
              'Include total count',
              false
            )
            return {
              ...common,
              entitySetName: recordType.entitySetName,
              ...(optionalString(params.listSelect) && {
                select: optionalString(params.listSelect),
              }),
              ...(optionalString(params.listFilter) && {
                filter: optionalString(params.listFilter),
              }),
              ...(optionalString(params.listOrderBy) && {
                orderBy: optionalString(params.listOrderBy),
              }),
              ...(optionalString(params.recordExpand) && {
                expand: optionalString(params.recordExpand),
              }),
              ...getListPaginationParams(params),
              count: includeCount ? 'true' : 'false',
            }
          }

          case 'get_record': {
            const recordType = getRecordType(params.recordType)
            return {
              ...common,
              entitySetName: recordType.entitySetName,
              recordId: normalizeDataverseGuid(
                requiredString(params.recordId, 'Record ID'),
                'Record ID'
              ),
              ...(optionalString(params.listSelect) && {
                select: optionalString(params.listSelect),
              }),
              ...(optionalString(params.recordExpand) && {
                expand: optionalString(params.recordExpand),
              }),
            }
          }

          case 'create_record': {
            const recordType = getRecordType(params.recordType)
            return {
              ...common,
              entitySetName: recordType.entitySetName,
              data: parseRequiredRecord(params.data),
            }
          }

          case 'update_record': {
            const recordType = getRecordType(params.recordType)
            return {
              ...common,
              entitySetName: recordType.entitySetName,
              recordId: normalizeDataverseGuid(
                requiredString(params.recordId, 'Record ID'),
                'Record ID'
              ),
              data: parseRequiredRecord(params.data),
            }
          }

          case 'search_records': {
            const recordType = getRecordType(params.recordType)
            const top =
              parseOptionalNumberInput(params.maxResults, 'Max results', {
                integer: true,
                min: 1,
                max: 100,
              }) ?? 100
            const skip = parseOptionalNumberInput(params.searchSkip, 'Search offset', {
              integer: true,
              min: 0,
              max: 2_147_483_647,
            })
            return {
              ...common,
              searchTerm: requiredString(params.searchTerm, 'Search term', 100),
              entities: JSON.stringify([{ name: recordType.logicalName }]),
              top,
              ...(skip !== undefined && { skip }),
              ...(optionalString(params.searchFilter) && {
                filter: optionalString(params.searchFilter),
              }),
              ...(optionalString(params.searchFacets) && {
                facets: optionalString(params.searchFacets),
              }),
              ...(optionalString(params.searchOrderBy) && {
                orderBy: optionalString(params.searchOrderBy),
              }),
              searchMode: requiredString(params.searchMode ?? 'any', 'Search mode'),
              searchType: requiredString(params.searchType ?? 'simple', 'Query type'),
            }
          }

          case 'list_owners': {
            const ownerType = getOwnerType(params.ownerType)
            return {
              ...common,
              entitySetName: ownerType.entitySetName,
              select: ownerType.select,
              filter: ownerType.filter,
              ...getListPaginationParams(params),
            }
          }

          case 'assign_record': {
            const recordType = getRecordType(params.recordType)
            const ownerType = getOwnerType(params.ownerType)
            const ownerId = normalizeDataverseGuid(
              requiredString(params.ownerId, 'Owner ID'),
              'Owner ID'
            )
            return {
              ...common,
              entitySetName: recordType.entitySetName,
              recordId: normalizeDataverseGuid(
                requiredString(params.recordId, 'Record ID'),
                'Record ID'
              ),
              data: {
                'ownerid@odata.bind': `/${ownerType.entitySetName}(${ownerId})`,
              },
            }
          }

          case 'qualify_lead': {
            const createOpportunity = parseBooleanWithDefault(
              params.createOpportunity,
              'Create opportunity',
              false
            )
            const statusReason = parseOptionalNumberInput(
              params.qualifyStatusReason,
              'Qualified status reason',
              { integer: true, min: -2_147_483_648, max: 2_147_483_647 }
            )
            const opportunityCurrencyId = createOpportunity
              ? optionalString(params.qualifyOpportunityCurrencyId)
              : undefined
            const opportunityCustomerId = createOpportunity
              ? optionalString(params.qualifyOpportunityCustomerId)
              : undefined
            const sourceCampaignId = createOpportunity
              ? optionalString(params.qualifySourceCampaignId)
              : undefined
            const processInstanceId = createOpportunity
              ? optionalString(params.qualifyProcessInstanceId)
              : undefined
            const processInstanceEntityType = createOpportunity
              ? optionalString(params.qualifyProcessInstanceEntityType)
              : undefined
            if (Boolean(processInstanceId) !== Boolean(processInstanceEntityType)) {
              throw new Error(
                'Process instance ID and process instance table must be provided together'
              )
            }
            const opportunityCustomerType = opportunityCustomerId
              ? requiredString(params.qualifyOpportunityCustomerType, 'Opportunity customer type')
              : undefined
            return {
              ...common,
              leadId: requiredString(params.leadId, 'Lead ID'),
              createAccount: parseBooleanWithDefault(params.createAccount, 'Create account', true),
              createContact: parseBooleanWithDefault(params.createContact, 'Create contact', true),
              createOpportunity,
              ...(statusReason !== undefined && { statusReason }),
              ...(opportunityCurrencyId && { opportunityCurrencyId }),
              ...(opportunityCustomerId && {
                opportunityCustomerId,
                opportunityCustomerType,
              }),
              ...(sourceCampaignId && { sourceCampaignId }),
              ...(processInstanceId && {
                processInstanceId,
                processInstanceEntityType: processInstanceEntityType as string,
              }),
            }
          }

          case 'close_opportunity': {
            const statusReason = parseOptionalNumberInput(
              params.opportunityStatusReason,
              'Opportunity status reason',
              { integer: true, min: -2_147_483_648, max: 2_147_483_647 }
            )
            const subject = optionalBoundedString(params.opportunitySubject, 'Close subject', 200)
            const description = optionalBoundedString(
              params.opportunityDescription,
              'Close notes',
              2_000
            )
            return {
              ...common,
              opportunityId: requiredString(params.closeOpportunityId, 'Opportunity ID'),
              outcome: requiredString(params.opportunityOutcome ?? 'won', 'Outcome'),
              ...(subject && { subject }),
              ...(description && { description }),
              ...(statusReason !== undefined && { statusReason }),
            }
          }

          case 'close_case': {
            const timeSpent = parseOptionalNumberInput(params.caseTimeSpent, 'Time spent', {
              integer: true,
              min: 0,
              max: 2_147_483_647,
            })
            const statusReason = parseOptionalNumberInput(
              params.caseStatusReason,
              'Case status reason',
              { integer: true, min: -2_147_483_648, max: 2_147_483_647 }
            )
            const description = optionalBoundedString(
              params.caseDescription,
              'Resolution notes',
              100_000
            )
            return {
              ...common,
              caseId: requiredString(params.caseId, 'Case ID'),
              subject: requiredString(params.caseSubject, 'Resolution subject', 200),
              ...(description && { description }),
              ...(timeSpent !== undefined && { timeSpent }),
              ...(statusReason !== undefined && { statusReason }),
            }
          }

          default:
            throw new Error(`Unsupported Dynamics 365 CRM operation: ${params.operation}`)
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'CRM operation to perform' },
    credential: { type: 'string', description: 'Microsoft Dataverse OAuth credential' },
    environmentUrl: { type: 'string', description: 'Dynamics 365 environment URL' },
    recordType: {
      type: 'string',
      description: 'Standard CRM record type: account, contact, lead, opportunity, or case',
    },
    recordId: { type: 'string', description: 'CRM record GUID' },
    data: { type: 'json', description: 'Record data using Dataverse logical column names' },
    listSelect: { type: 'string', description: 'Comma-separated columns to return' },
    listFilter: { type: 'string', description: 'OData filter for record listing' },
    listOrderBy: { type: 'string', description: 'OData ordering for record listing' },
    recordExpand: { type: 'string', description: 'OData relationships to expand' },
    maxResults: { type: 'string', description: 'Maximum results for a single page (1-100)' },
    includeCount: { type: 'boolean', description: 'Whether to request the total matching count' },
    nextLink: { type: 'string', description: 'Opaque next-page URL from a previous list result' },
    nextPageSize: {
      type: 'string',
      description: 'Page size paired with the previous list result nextLink',
    },
    searchTerm: { type: 'string', description: 'Dataverse Search query text' },
    searchSkip: { type: 'string', description: 'Number of earlier search results to skip' },
    searchFilter: { type: 'string', description: 'Global OData filter for Dataverse Search' },
    searchFacets: { type: 'string', description: 'JSON array of Dataverse Search facets' },
    searchOrderBy: {
      type: 'string',
      description: 'JSON array of Dataverse Search sort expressions',
    },
    searchMode: { type: 'string', description: 'Search mode: any or all' },
    searchType: { type: 'string', description: 'Search query type: simple or lucene' },
    ownerType: { type: 'string', description: 'Owner type: user or team' },
    ownerId: { type: 'string', description: 'User or team GUID to assign' },
    leadId: { type: 'string', description: 'Lead GUID to qualify' },
    createAccount: { type: 'boolean', description: 'Whether qualification creates an account' },
    createContact: { type: 'boolean', description: 'Whether qualification creates a contact' },
    createOpportunity: {
      type: 'boolean',
      description: 'Whether qualification creates an opportunity',
    },
    qualifyStatusReason: {
      type: 'string',
      description: 'Custom qualified lead status reason integer',
    },
    qualifyOpportunityCurrencyId: {
      type: 'string',
      description: 'Transaction currency GUID for a created opportunity',
    },
    qualifyOpportunityCustomerId: {
      type: 'string',
      description: 'Account or contact GUID for a created opportunity',
    },
    qualifyOpportunityCustomerType: {
      type: 'string',
      description: 'Created opportunity customer type: account or contact',
    },
    qualifySourceCampaignId: {
      type: 'string',
      description: 'Source campaign GUID for lead qualification',
    },
    qualifyProcessInstanceId: {
      type: 'string',
      description: 'Business process flow instance GUID for lead qualification',
    },
    qualifyProcessInstanceEntityType: {
      type: 'string',
      description: 'Logical table name for the business process flow instance',
    },
    closeOpportunityId: { type: 'string', description: 'Opportunity GUID to close' },
    opportunityOutcome: { type: 'string', description: 'Opportunity outcome: won or lost' },
    opportunitySubject: { type: 'string', description: 'Opportunity close subject' },
    opportunityDescription: { type: 'string', description: 'Optional opportunity close notes' },
    opportunityStatusReason: {
      type: 'string',
      description: 'Custom won or lost status reason integer',
    },
    caseId: { type: 'string', description: 'Case GUID to resolve' },
    caseSubject: { type: 'string', description: 'Case resolution subject' },
    caseDescription: { type: 'string', description: 'Optional case resolution notes' },
    caseTimeSpent: { type: 'string', description: 'Whole minutes spent resolving the case' },
    caseStatusReason: { type: 'string', description: 'Custom resolved status reason integer' },
  },
  outputs: {
    records: {
      type: 'json',
      description: 'Current page of CRM or owner records with table-specific dynamic columns',
    },
    record: {
      type: 'json',
      description: 'CRM record with table-specific dynamic columns',
    },
    recordId: { type: 'string', description: 'Created, retrieved, updated, or assigned record ID' },
    count: { type: 'number', description: 'Number of records returned in the current page' },
    totalCount: {
      type: 'number',
      description: 'Provider-reported matching count, which Dataverse may cap',
    },
    totalCountLimitExceeded: {
      type: 'boolean',
      description: 'Whether Dataverse capped the provider-reported matching count',
    },
    nextLink: { type: 'string', description: 'Opaque provider URL for the next records page' },
    nextPageSize: {
      type: 'number',
      description: 'Page size that must accompany the next records page URL',
    },
    results: {
      type: 'json',
      description: 'Current page of Dataverse Search results with table-specific attributes',
    },
    facets: { type: 'json', description: 'Dataverse Search facet results when requested' },
    createdEntities: {
      type: 'json',
      description: 'Entity references returned by the QualifyLead action',
    },
    opportunityId: { type: 'string', description: 'Opportunity ID supplied to the close action' },
    outcome: { type: 'string', description: 'Opportunity close outcome: won or lost' },
    caseId: { type: 'string', description: 'Case ID supplied to the close action' },
    success: { type: 'boolean', description: 'Whether the selected operation succeeded' },
  },
}

export const MicrosoftDynamics365BlockMeta = {
  tags: ['microsoft-365', 'sales-engagement', 'customer-support', 'cloud'],
  url: 'https://www.microsoft.com/dynamics-365',
  templates: [
    {
      icon: MicrosoftDataverseIcon,
      title: 'Dynamics lead intake',
      prompt:
        'Build a workflow that receives a new prospect, searches Microsoft Dynamics 365 CRM for a matching lead, creates the lead when no match exists, and notifies the sales team in Microsoft Teams.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['crm', 'lead-management', 'automation'],
      alsoIntegrations: ['microsoft_teams'],
      featured: true,
    },
    {
      icon: MicrosoftDataverseIcon,
      title: 'Dynamics lead qualification',
      prompt:
        'Create a workflow that retrieves a Dynamics 365 lead after a qualification decision, qualifies it with the requested account, contact, and opportunity choices, and sends the resulting entity references to Microsoft Teams.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['crm', 'lead-management', 'sales'],
      alsoIntegrations: ['microsoft_teams'],
    },
    {
      icon: MicrosoftDataverseIcon,
      title: 'Dynamics customer sync',
      prompt:
        'Build a scheduled workflow that lists Dynamics 365 accounts and contacts, normalizes the current page into a Sim table, and updates matching CRM records when approved source data changes.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['crm', 'sync', 'data-quality'],
    },
    {
      icon: MicrosoftDataverseIcon,
      title: 'Dynamics pipeline review',
      prompt:
        'Create a scheduled workflow that lists open Dynamics 365 opportunities with an OData filter, summarizes the current page by owner and expected close date, and posts the review to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['crm', 'pipeline', 'reporting'],
      alsoIntegrations: ['slack'],
      featured: true,
    },
    {
      icon: MicrosoftDataverseIcon,
      title: 'Dynamics stale deal follow-up',
      prompt:
        'Build a scheduled workflow that lists Dynamics 365 opportunities with old activity dates, retrieves customer context, drafts follow-up messages in Outlook, and updates the reviewed opportunities with your organization’s approved fields.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['crm', 'pipeline', 'follow-up'],
      alsoIntegrations: ['outlook'],
    },
    {
      icon: MicrosoftDataverseIcon,
      title: 'Dynamics closed-deal handoff',
      prompt:
        'Create a workflow that closes an approved Dynamics 365 opportunity as won or lost, retrieves the related CRM context, and posts a handoff summary to Microsoft Teams.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['crm', 'handoff', 'sales'],
      alsoIntegrations: ['microsoft_teams'],
    },
    {
      icon: MicrosoftDataverseIcon,
      title: 'Dynamics case routing',
      prompt:
        'Build a workflow that searches Dynamics 365 for customer and case context, lists candidate users or owner-capable teams, assigns the case to the selected owner, and notifies the support channel in Microsoft Teams.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['crm', 'case-management', 'routing'],
      alsoIntegrations: ['microsoft_teams'],
      featured: true,
    },
    {
      icon: MicrosoftDataverseIcon,
      title: 'Dynamics case resolution',
      prompt:
        'Create a workflow that retrieves an approved Dynamics 365 case, records the resolution subject, notes, and time spent, resolves the case, and sends the customer a follow-up through Outlook.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['crm', 'case-management', 'customer-support'],
      alsoIntegrations: ['outlook'],
    },
  ],
  skills: [
    {
      name: 'find-customer-context',
      description:
        'Find an account, contact, lead, opportunity, or case and retrieve its current CRM details.',
      content:
        '# Find Customer Context\n\nUse this skill when a request names a customer, prospect, deal, or support issue but does not yet provide a Dynamics 365 record ID.\n\n## Steps\n1. Choose the most likely standard CRM record type.\n2. Use Search Records with a focused search term; Dataverse Search must be enabled.\n3. If search is unavailable, use List Records with a narrow OData filter.\n4. Use Get Record with the selected ID and request only the columns and relationships needed.\n5. If multiple records remain plausible, present them for user selection rather than guessing.\n\n## Output\nThe selected record ID, record type, and relevant current fields.',
    },
    {
      name: 'maintain-customer-record',
      description:
        'Create or update a standard Dynamics 365 CRM record while preserving organization-specific fields.',
      content:
        '# Maintain Customer Record\n\nUse this skill to add or change an account, contact, lead, opportunity, or case.\n\n## Steps\n1. Identify the standard CRM record type and the logical column names required by the environment.\n2. Search or list records first when duplicate creation is possible.\n3. Use Create Record with a JSON object for a new row, or Get Record followed by Update Record for an existing row.\n4. Send only fields the user intends to change; do not infer custom choice values, lookups, or required fields.\n5. Return the affected record ID and any provider error that requires an administrator or different security role.\n\n## Output\nThe affected record ID and a concise summary of the submitted fields.',
    },
    {
      name: 'route-crm-record',
      description:
        'List candidate Dynamics 365 owners and assign a CRM record to a user or owner-capable team.',
      content:
        '# Route CRM Record\n\nUse this skill when an account, contact, lead, opportunity, or case must be handed to a Dynamics 365 user or team.\n\n## Steps\n1. Identify the target record type and record ID.\n2. Use List Owners for active users or owner-capable teams and keep the result to one bounded page. Treat these as candidates because Dataverse still enforces security roles and table privileges.\n3. Ask the user to choose when more than one owner is plausible.\n4. Use Assign Record with the chosen owner type and GUID.\n5. Surface permission errors; assignment requires the appropriate Dataverse privileges.\n\n## Output\nThe assigned record ID, owner type, and selected owner ID.',
    },
    {
      name: 'qualify-sales-lead',
      description:
        'Qualify an approved Dynamics 365 lead and control which account, contact, and opportunity records are created.',
      content:
        '# Qualify Sales Lead\n\nUse this skill only after the user or an approved workflow step has decided that a lead is qualified.\n\n## Steps\n1. Retrieve the lead and confirm the intended record ID.\n2. Confirm whether qualification should create an account, contact, and opportunity; never assume all three.\n3. When creating an opportunity, include customer or currency references only when their GUIDs and concrete types are known.\n4. Use Qualify Lead once. Do not automatically retry this mutation.\n5. Return the entity references that Dynamics 365 actually reports, without inventing missing record IDs.\n\n## Output\nThe provider-returned created entity references and qualification success.',
    },
    {
      name: 'review-sales-pipeline',
      description:
        'Review a bounded page of Dynamics 365 opportunities and identify deals needing attention.',
      content:
        '# Review Sales Pipeline\n\nUse this skill for periodic pipeline reviews or focused opportunity analysis.\n\n## Steps\n1. Use List Records for opportunities with explicit selected columns, an OData filter, ordering, and a maximum page size of 100 results.\n2. Treat a returned next-page link as evidence that the review is incomplete; do not claim full-pipeline coverage.\n3. If totalCountLimitExceeded is true, describe the reported count as capped rather than exact.\n4. Retrieve individual opportunities only when more context is needed.\n5. Group the returned page by owner, stage, expected close date, or another field explicitly present in the records.\n6. Distinguish provider data from recommendations.\n\n## Output\nA current-page pipeline summary, flagged opportunities, and whether additional pages or a capped count exist.',
    },
    {
      name: 'close-sales-opportunity',
      description:
        'Close an approved Dynamics 365 opportunity as won or lost with an explicit outcome summary.',
      content:
        '# Close Sales Opportunity\n\nUse this skill only after the user or an authorized workflow step has approved the final outcome.\n\n## Steps\n1. Retrieve the opportunity and confirm its record ID and intended outcome.\n2. Optionally gather a close subject and notes.\n3. Use Close Opportunity with won or lost; supply a custom status-reason integer only when the environment defines it.\n4. Do not retry the close action automatically.\n5. Report the supplied opportunity ID and outcome without claiming a response status Dynamics 365 did not return.\n\n## Output\nThe closed opportunity ID, chosen outcome, and action success.',
    },
    {
      name: 'resolve-customer-case',
      description:
        'Resolve an approved Dynamics 365 case with documented resolution details and time spent.',
      content:
        '# Resolve Customer Case\n\nUse this skill after support work is complete and resolution has been approved.\n\n## Steps\n1. Retrieve the case and confirm it is the intended active case.\n2. Gather a concise resolution subject, optional notes, and optional nonnegative whole minutes spent.\n3. Use Close Case once; use a custom status-reason integer only when the environment defines it.\n4. Do not automatically retry the resolution mutation.\n5. Surface security-role, privilege, plugin, or status-reason errors without rewriting them as success.\n\n## Output\nThe resolved case ID and action success.',
    },
  ],
} as const satisfies BlockMeta
