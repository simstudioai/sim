import type { ToolResponse } from '@/tools/types'

export interface NetSuiteAuthParams {
  /** ID of the selected reusable NetSuite service-account credential. */
  oauthCredential: string
  /** Short-lived access token injected by the executor from the credential. */
  accessToken?: string
  /** SuiteTalk account origin injected by the executor from the credential. */
  instanceUrl?: string
}

export interface NetSuitePaginationParams {
  limit?: number
  offset?: number
}

export interface NetSuiteRecordQueryParams {
  fields?: string
  expand?: string
  expandSubResources?: boolean
}

export type NetSuiteJsonObject = Record<string, unknown>

export interface NetSuiteResponse extends ToolResponse {
  output: {
    status: number
    data: unknown | null
    location?: string
    jobId?: string
  }
}

export interface NetSuiteListRecordsParams extends NetSuiteAuthParams, NetSuitePaginationParams {
  recordType: string
  q?: string
}

export interface NetSuiteGetRecordParams extends NetSuiteAuthParams, NetSuiteRecordQueryParams {
  recordType: string
  recordId: string
}

export interface NetSuiteCreateRecordParams extends NetSuiteAuthParams {
  recordType: string
  body: NetSuiteJsonObject
  replace?: string
}

export interface NetSuiteUpdateRecordParams extends NetSuiteAuthParams {
  recordType: string
  recordId: string
  body: NetSuiteJsonObject
  replace?: string
}

export interface NetSuiteUpsertRecordParams extends NetSuiteAuthParams {
  recordType: string
  externalId: string
  body: NetSuiteJsonObject
}

export interface NetSuiteDeleteRecordParams extends NetSuiteAuthParams {
  recordType: string
  recordId: string
}

export interface NetSuiteGetSubresourceParams extends NetSuiteAuthParams {
  recordType: string
  recordId: string
  subresourcePath: string
}

export interface NetSuiteGetRecordFormParams extends NetSuiteAuthParams, NetSuiteRecordQueryParams {
  recordType: string
  recordId?: string
  body?: NetSuiteJsonObject
}

export interface NetSuiteGetSelectOptionsParams
  extends NetSuiteAuthParams,
    NetSuitePaginationParams {
  recordType: string
  fields: string
  recordId?: string
  q?: string
  body?: NetSuiteJsonObject
}

export interface NetSuiteRelationshipParams extends NetSuiteAuthParams {
  recordType: string
  recordId: string
  relatedType: 'contact' | 'file'
  relatedId: string
}

export interface NetSuiteAttachParams extends NetSuiteRelationshipParams {
  roleId?: string
  roleExternalId?: string
}

export interface NetSuiteExecuteActionParams extends NetSuiteAuthParams {
  recordType: string
  recordId: string
  action: string
  body?: NetSuiteJsonObject
}

export interface NetSuiteTransformRecordParams extends NetSuiteAuthParams {
  recordType: string
  recordId: string
  targetRecordType: string
  body?: NetSuiteJsonObject
}

export interface NetSuiteBatchGetParams extends NetSuiteAuthParams, NetSuiteRecordQueryParams {
  recordType: string
  ids: string
  idempotencyKey?: string
}

export interface NetSuiteBatchWriteParams extends NetSuiteAuthParams {
  recordType: string
  items: NetSuiteJsonObject[]
  idempotencyKey?: string
}

export interface NetSuiteBatchDeleteParams extends NetSuiteAuthParams {
  recordType: string
  ids: string
  idempotencyKey?: string
}

export interface NetSuiteSuiteQLParams extends NetSuiteAuthParams, NetSuitePaginationParams {
  query: string
}

export interface NetSuiteListDatasetsParams extends NetSuiteAuthParams, NetSuitePaginationParams {}

export interface NetSuiteExecuteDatasetParams extends NetSuiteAuthParams, NetSuitePaginationParams {
  datasetId: string
}

export interface NetSuiteListRecordTypesParams extends NetSuiteAuthParams {}

export type NetSuiteMetadataFormat = 'default' | 'openapi' | 'json_schema'

export interface NetSuiteGetRecordMetadataParams extends NetSuiteAuthParams {
  recordType: string
  format?: NetSuiteMetadataFormat
}

export interface NetSuiteGetAsyncStatusParams extends NetSuiteAuthParams {
  jobId: string
  view?: 'job' | 'tasks' | 'task'
  taskId?: string
}

export interface NetSuiteGetAsyncResultParams extends NetSuiteAuthParams {
  jobId: string
  taskId: string
}

export interface NetSuiteSystemParams extends NetSuiteAuthParams {}
