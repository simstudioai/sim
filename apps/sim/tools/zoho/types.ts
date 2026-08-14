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

/** A CRM write result entry, as returned in the `data` array of insert/update/upsert. */
export interface ZohoCrmWriteResult {
  id: string | null
  code: string | null
  status: string | null
  message: string | null
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
