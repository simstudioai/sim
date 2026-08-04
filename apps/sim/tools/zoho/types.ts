import type { ToolResponse } from '@/tools/types'

/** Params shared by every Zoho tool: the OAuth token and the account's region. */
export interface ZohoBaseParams {
  accessToken: string
  dataCenter?: string
}

/** Params shared by every Zoho Desk tool — Desk requires an `orgId` header. */
export interface ZohoDeskBaseParams extends ZohoBaseParams {
  orgId: string
}

/**
 * Pagination block returned by CRM list/search endpoints.
 * @see https://www.zoho.com/crm/developer/docs/api/v8/get-records.html
 */
export interface ZohoCrmPageInfo {
  page: number | null
  perPage: number | null
  count: number | null
  moreRecords: boolean
}

export const ZOHO_CRM_PAGE_INFO_OUTPUT = {
  type: 'object' as const,
  description: 'Pagination metadata returned by Zoho CRM',
  properties: {
    page: { type: 'number' as const, description: 'Current page number', optional: true },
    perPage: { type: 'number' as const, description: 'Records requested per page', optional: true },
    count: {
      type: 'number' as const,
      description: 'Number of records in this page',
      optional: true,
    },
    moreRecords: { type: 'boolean' as const, description: 'Whether further pages are available' },
  },
}

/** A CRM write result entry, as returned in the `data` array of insert/update/upsert. */
export interface ZohoCrmWriteResult {
  id: string | null
  code: string | null
  status: string | null
  message: string | null
}

export const ZOHO_CRM_WRITE_RESULT_OUTPUT = {
  type: 'array' as const,
  description: 'Per-record results returned by Zoho CRM',
  properties: {
    id: { type: 'string' as const, description: 'Record ID', optional: true },
    code: {
      type: 'string' as const,
      description: 'Zoho result code (e.g. SUCCESS)',
      optional: true,
    },
    status: { type: 'string' as const, description: 'Result status', optional: true },
    message: {
      type: 'string' as const,
      description: 'Human-readable result message',
      optional: true,
    },
  },
}

export interface ZohoCrmGetRecordsParams extends ZohoBaseParams {
  module: string
  recordId?: string
  fields?: string
  page?: string | number
  perPage?: string | number
  sortBy?: string
  sortOrder?: string
}

export interface ZohoCrmGetRecordsResponse extends ToolResponse {
  output: {
    records: Record<string, unknown>[]
    record?: Record<string, unknown> | null
    info: ZohoCrmPageInfo
  }
}

export interface ZohoCrmCreateRecordsParams extends ZohoBaseParams {
  module: string
  records: unknown
  trigger?: string
}

export interface ZohoCrmWriteResponse extends ToolResponse {
  output: {
    results: ZohoCrmWriteResult[]
  }
}

export interface ZohoCrmUpdateRecordParams extends ZohoBaseParams {
  module: string
  recordId: string
  record: unknown
  trigger?: string
}

export interface ZohoCrmUpsertRecordsParams extends ZohoBaseParams {
  module: string
  records: unknown
  duplicateCheckFields?: string
  trigger?: string
}

export interface ZohoCrmDeleteRecordParams extends ZohoBaseParams {
  module: string
  recordId: string
  wfTrigger?: string
}

export interface ZohoCrmSearchRecordsParams extends ZohoBaseParams {
  module: string
  criteria?: string
  email?: string
  phone?: string
  word?: string
  fields?: string
  page?: string | number
  perPage?: string | number
}

export interface ZohoCrmCoqlQueryParams extends ZohoBaseParams {
  selectQuery: string
}

export interface ZohoCrmCoqlQueryResponse extends ToolResponse {
  output: {
    records: Record<string, unknown>[]
    info: ZohoCrmPageInfo
  }
}

export interface ZohoCrmGetModulesParams extends ZohoBaseParams {}

export interface ZohoCrmGetModulesResponse extends ToolResponse {
  output: {
    modules: Array<{
      apiName: string | null
      moduleName: string | null
      id: string | null
      pluralLabel: string | null
      singularLabel: string | null
      creatable: boolean | null
      editable: boolean | null
      deletable: boolean | null
    }>
  }
}

export interface ZohoCrmGetFieldsParams extends ZohoBaseParams {
  module: string
}

export interface ZohoCrmGetFieldsResponse extends ToolResponse {
  output: {
    fields: Array<{
      apiName: string | null
      displayLabel: string | null
      dataType: string | null
      id: string | null
      required: boolean | null
      readOnly: boolean | null
      length: number | null
    }>
  }
}

export interface ZohoCrmGetUsersParams extends ZohoBaseParams {
  type?: string
  page?: string | number
  perPage?: string | number
}

export interface ZohoCrmGetUsersResponse extends ToolResponse {
  output: {
    users: Record<string, unknown>[]
    info: ZohoCrmPageInfo
  }
}

export interface ZohoCrmAddNoteParams extends ZohoBaseParams {
  parentId: string
  seModule: string
  noteTitle?: string
  noteContent: string
}

export type ZohoCrmResponse =
  | ZohoCrmGetRecordsResponse
  | ZohoCrmWriteResponse
  | ZohoCrmCoqlQueryResponse
  | ZohoCrmGetModulesResponse
  | ZohoCrmGetFieldsResponse
  | ZohoCrmGetUsersResponse
