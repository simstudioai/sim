import type { OutputProperty, ToolResponse } from '@/tools/types'

/**
 * Microsoft Dataverse Web API types.
 * @see https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/overview
 */

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
  environmentUrl: string
  entitySetName: string
  data: Record<string, unknown>
}

export interface DataverseGetRecordParams {
  accessToken: string
  environmentUrl: string
  entitySetName: string
  recordId: string
  select?: string
  expand?: string
}

export interface DataverseUpdateRecordParams {
  accessToken: string
  environmentUrl: string
  entitySetName: string
  recordId: string
  data: Record<string, unknown>
}

export interface DataverseDeleteRecordParams {
  accessToken: string
  environmentUrl: string
  entitySetName: string
  recordId: string
}

export interface DataverseListRecordsParams {
  accessToken: string
  environmentUrl: string
  entitySetName: string
  select?: string
  filter?: string
  orderBy?: string
  top?: number
  expand?: string
  count?: string
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

export interface DataverseDeleteRecordResponse extends ToolResponse {
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
    nextLink: string | null
    success: boolean
  }
}

export interface DataverseUpsertRecordParams {
  accessToken: string
  environmentUrl: string
  entitySetName: string
  recordId: string
  data: Record<string, unknown>
}

export interface DataverseUpsertRecordResponse extends ToolResponse {
  output: {
    recordId: string
    created: boolean
    record: Record<string, unknown> | null
    success: boolean
  }
}

export interface DataverseWhoAmIParams {
  accessToken: string
  environmentUrl: string
}

export interface DataverseWhoAmIResponse extends ToolResponse {
  output: {
    userId: string
    businessUnitId: string
    organizationId: string
    success: boolean
  }
}

export interface DataverseAssociateParams {
  accessToken: string
  environmentUrl: string
  entitySetName: string
  recordId: string
  navigationProperty: string
  targetEntitySetName: string
  targetRecordId: string
  navigationType?: 'collection' | 'single'
}

export interface DataverseAssociateResponse extends ToolResponse {
  output: {
    success: boolean
    entitySetName: string
    recordId: string
    navigationProperty: string
    targetEntitySetName: string
    targetRecordId: string
  }
}

export interface DataverseDisassociateParams {
  accessToken: string
  environmentUrl: string
  entitySetName: string
  recordId: string
  navigationProperty: string
  targetRecordId?: string
}

export interface DataverseDisassociateResponse extends ToolResponse {
  output: {
    success: boolean
    entitySetName: string
    recordId: string
    navigationProperty: string
    targetRecordId?: string
  }
}

export type DataverseResponse =
  | DataverseCreateRecordResponse
  | DataverseGetRecordResponse
  | DataverseUpdateRecordResponse
  | DataverseDeleteRecordResponse
  | DataverseListRecordsResponse
  | DataverseUpsertRecordResponse
  | DataverseWhoAmIResponse
  | DataverseAssociateResponse
  | DataverseDisassociateResponse
