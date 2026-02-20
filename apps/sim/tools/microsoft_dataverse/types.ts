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

export interface DataverseFetchXmlQueryParams {
  accessToken: string
  environmentUrl: string
  entitySetName: string
  fetchXml: string
}

export interface DataverseFetchXmlQueryResponse extends ToolResponse {
  output: {
    records: Record<string, unknown>[]
    count: number
    fetchXmlPagingCookie: string | null
    moreRecords: boolean
    success: boolean
  }
}

export interface DataverseExecuteActionParams {
  accessToken: string
  environmentUrl: string
  actionName: string
  entitySetName?: string
  recordId?: string
  parameters?: Record<string, unknown>
}

export interface DataverseExecuteActionResponse extends ToolResponse {
  output: {
    result: Record<string, unknown> | null
    success: boolean
  }
}

export interface DataverseExecuteFunctionParams {
  accessToken: string
  environmentUrl: string
  functionName: string
  entitySetName?: string
  recordId?: string
  parameters?: string
}

export interface DataverseExecuteFunctionResponse extends ToolResponse {
  output: {
    result: Record<string, unknown> | null
    success: boolean
  }
}

export interface DataverseCreateMultipleParams {
  accessToken: string
  environmentUrl: string
  entitySetName: string
  entityLogicalName: string
  records: Record<string, unknown>[]
}

export interface DataverseCreateMultipleResponse extends ToolResponse {
  output: {
    ids: string[]
    count: number
    success: boolean
  }
}

export interface DataverseUpdateMultipleParams {
  accessToken: string
  environmentUrl: string
  entitySetName: string
  entityLogicalName: string
  records: Record<string, unknown>[]
}

export interface DataverseUpdateMultipleResponse extends ToolResponse {
  output: {
    success: boolean
  }
}

export interface DataverseUploadFileParams {
  accessToken: string
  environmentUrl: string
  entitySetName: string
  recordId: string
  fileColumn: string
  fileName: string
  file?: unknown
  fileContent?: string
}

export interface DataverseUploadFileResponse extends ToolResponse {
  output: {
    recordId: string
    fileColumn: string
    fileName: string
    success: boolean
  }
}

export interface DataverseDownloadFileParams {
  accessToken: string
  environmentUrl: string
  entitySetName: string
  recordId: string
  fileColumn: string
}

export interface DataverseDownloadFileResponse extends ToolResponse {
  output: {
    fileContent: string
    fileName: string
    fileSize: number
    mimeType: string
    success: boolean
  }
}

export interface DataverseSearchParams {
  accessToken: string
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
  | DataverseFetchXmlQueryResponse
  | DataverseExecuteActionResponse
  | DataverseExecuteFunctionResponse
  | DataverseCreateMultipleResponse
  | DataverseUpdateMultipleResponse
  | DataverseUploadFileResponse
  | DataverseDownloadFileResponse
  | DataverseSearchResponse
