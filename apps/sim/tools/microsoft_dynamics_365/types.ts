import type { OutputProperty, ToolResponse } from '@/tools/types'

/**
 * Dataverse record output definition.
 * Dataverse records are dynamic (user-defined tables), so columns vary by table.
 * Every record includes OData metadata fields such as `@odata.etag`.
 * @see https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/retrieve-entity-using-web-api
 */
export const DATAVERSE_RECORD_OUTPUT: OutputProperty = {
  type: 'object',
  description:
    'Dataverse record object. Contains dynamic columns based on the queried table, plus OData metadata fields.',
  properties: {
    '@odata.context': {
      type: 'string',
      description: 'OData context URL describing the entity type and properties returned',
      optional: true,
    },
    '@odata.etag': {
      type: 'string',
      description: 'OData entity tag for concurrency control (e.g., W/"12345")',
      optional: true,
    },
  },
}

/**
 * Array of Dataverse records output definition for list endpoints.
 * Each item mirrors `DATAVERSE_RECORD_OUTPUT`.
 * @see https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/query-data-web-api
 */
export const DATAVERSE_RECORDS_ARRAY_OUTPUT: OutputProperty = {
  type: 'array',
  description:
    'Array of Dataverse records. Each record has dynamic columns based on the table schema.',
  items: {
    type: 'object',
    description: 'A single Dataverse record with dynamic columns based on the table schema',
    properties: {
      '@odata.etag': {
        type: 'string',
        description: 'OData entity tag for concurrency control (e.g., W/"12345")',
        optional: true,
      },
    },
  },
}

export interface DataverseCreateRecordParams {
  accessToken: string
  instanceUrl: string
  environmentUrl: string
  entitySetName: string
  data: Record<string, unknown>
}

export interface DataverseGetRecordParams {
  accessToken: string
  instanceUrl: string
  environmentUrl: string
  entitySetName: string
  recordId: string
  select?: string
  expand?: string
}

export interface DataverseUpdateRecordParams {
  accessToken: string
  instanceUrl: string
  environmentUrl: string
  entitySetName: string
  recordId: string
  data: Record<string, unknown>
}

export interface DataverseListRecordsParams {
  accessToken: string
  instanceUrl: string
  environmentUrl: string
  entitySetName: string
  select?: string
  filter?: string
  orderBy?: string
  pageSize?: number
  expand?: string
  count?: string
  nextLink?: string
  nextPageSize?: number
}

export interface DataverseCreateRecordResponse extends ToolResponse {
  output: {
    recordId: string
    record: Record<string, unknown>
    success: boolean
  }
}

export interface DataverseGetRecordResponse extends ToolResponse {
  output: {
    record: Record<string, unknown>
    recordId: string
    success: boolean
  }
}

export interface DataverseUpdateRecordResponse extends ToolResponse {
  output: {
    recordId: string
    success: boolean
  }
}

export interface DataverseListRecordsResponse extends ToolResponse {
  output: {
    records: Record<string, unknown>[]
    count: number
    totalCount: number | null
    totalCountLimitExceeded: boolean | null
    nextLink: string | null
    nextPageSize: number | null
    success: boolean
  }
}

export interface DataverseSearchParams {
  accessToken: string
  instanceUrl: string
  environmentUrl: string
  searchTerm: string
  entities?: string
  filter?: string
  facets?: string
  top?: number
  skip?: number
  orderBy?: string
  searchMode?: string
  searchType?: string
}

export interface DataverseSearchResponse extends ToolResponse {
  output: {
    results: Record<string, unknown>[]
    totalCount: number
    count: number
    facets: Record<string, unknown> | null
    success: boolean
  }
}

export interface DataverseQualifyLeadParams {
  accessToken: string
  instanceUrl: string
  environmentUrl: string
  leadId: string
  createAccount: boolean
  createContact: boolean
  createOpportunity: boolean
  statusReason?: number
  opportunityCurrencyId?: string
  opportunityCustomerId?: string
  opportunityCustomerType?: 'account' | 'contact'
  sourceCampaignId?: string
  processInstanceId?: string
  processInstanceEntityType?: string
}

export interface DataverseQualifyLeadResponse extends ToolResponse {
  output: {
    createdEntities: Record<string, unknown>[]
    success: boolean
  }
}

export type DataverseOpportunityOutcome = 'won' | 'lost'

export interface DataverseCloseOpportunityParams {
  accessToken: string
  instanceUrl: string
  environmentUrl: string
  opportunityId: string
  outcome: DataverseOpportunityOutcome
  subject?: string
  description?: string
  statusReason?: number
}

export interface DataverseCloseOpportunityResponse extends ToolResponse {
  output: {
    opportunityId: string
    outcome: DataverseOpportunityOutcome
    success: boolean
  }
}

export interface DataverseCloseCaseParams {
  accessToken: string
  instanceUrl: string
  environmentUrl: string
  caseId: string
  subject: string
  description?: string
  timeSpent?: number
  statusReason?: number
}

export interface DataverseCloseCaseResponse extends ToolResponse {
  output: {
    caseId: string
    success: boolean
  }
}

export type DataverseResponse =
  | DataverseListRecordsResponse
  | DataverseGetRecordResponse
  | DataverseCreateRecordResponse
  | DataverseUpdateRecordResponse
  | DataverseSearchResponse
  | DataverseQualifyLeadResponse
  | DataverseCloseOpportunityResponse
  | DataverseCloseCaseResponse
