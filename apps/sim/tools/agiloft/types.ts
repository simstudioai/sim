import type { ToolResponse } from '@/tools/types'

/**
 * Connection and credentials. `table` is optional here because EWLogin is
 * KB-scoped and EWTable operates across the whole knowledge base; every
 * table-scoped operation uses `AgiloftBaseParams` below instead.
 */
export interface AgiloftCredentials {
  instanceUrl: string
  knowledgeBase: string
  login: string
  password: string
  table?: string
}

/** Credentials plus the table a table-scoped operation acts on. */
export interface AgiloftBaseParams extends AgiloftCredentials {
  table: string
}

export interface AgiloftCreateRecordParams extends AgiloftBaseParams {
  data: string
}

export interface AgiloftReadRecordParams extends AgiloftBaseParams {
  recordId: string
  fields?: string
}

export interface AgiloftUpdateRecordParams extends AgiloftBaseParams {
  recordId: string
  data: string
}

/** Strategies EWDelete accepts for records that depend on the one being deleted. */
export type AgiloftDeleteRule =
  | 'ERROR_IF_DEPENDANTS'
  | 'APPLY_DELETE_WHERE_POSSIBLE'
  | 'DELETE_WHERE_POSSIBLE_OTHERWISE_UNLINK'
  | 'APPLY_UNLINK'
  | 'UNLINK_WHERE_POSSIBLE_OTHERWISE_DELETE'
  | 'REPLACE_WITH_ANOTHER'

export interface AgiloftDeleteRecordParams extends AgiloftBaseParams {
  recordId: string
  deleteRule?: AgiloftDeleteRule
  /** Comma-separated substitute record IDs; read only under REPLACE_WITH_ANOTHER. */
  substituteIds?: string
}

export interface AgiloftSearchRecordsParams extends AgiloftBaseParams {
  query?: string
  search?: string
  fields?: string
  page?: string
  limit?: string
}

export interface AgiloftSelectRecordsParams extends AgiloftBaseParams {
  where: string
}

export interface AgiloftAttachmentInfoParams extends AgiloftBaseParams {
  recordId: string
  fieldName: string
}

export interface AgiloftLockRecordParams extends AgiloftBaseParams {
  recordId: string
  lockAction: 'lock' | 'unlock' | 'check'
  force?: boolean
}

export interface AgiloftRecordResponse extends ToolResponse {
  output: {
    id: string | null
    fields: Record<string, unknown>
  }
}

export interface AgiloftDeleteResponse extends ToolResponse {
  output: {
    id: string
    deleted: boolean
  }
}

export interface AgiloftSearchResponse extends ToolResponse {
  output: {
    records: Record<string, unknown>[]
    totalCount: number
    page: number
    limit: number
    truncated: boolean
  }
}

export interface AgiloftSelectResponse extends ToolResponse {
  output: {
    recordIds: string[]
    totalCount: number
    truncated: boolean
  }
}

export interface AgiloftAttachmentInfoResponse extends ToolResponse {
  output: {
    attachments: Array<{
      position: number
      name: string
      size: number
    }>
    totalCount: number
  }
}

export interface AgiloftLockResponse extends ToolResponse {
  output: {
    id: string
    tableId: number | null
    lockStatus: string
    lockedBy: string | null
    lockExpiresInMinutes: number | null
  }
}

export interface AgiloftAttachFileParams extends AgiloftBaseParams {
  recordId: string
  fieldName: string
  file?: unknown
  fileName?: string
  overwrite?: boolean
}

export interface AgiloftAttachFileResponse extends ToolResponse {
  output: {
    recordId: string
    fieldName: string
    fileName: string
    totalAttachments: number
  }
}

export interface AgiloftRetrieveAttachmentParams extends AgiloftBaseParams {
  recordId: string
  fieldName: string
  position: string
}

export interface AgiloftRetrieveAttachmentResponse extends ToolResponse {
  output: {
    file: {
      name: string
      mimeType: string
      data: string
      size: number
    }
  }
}

export interface AgiloftRemoveAttachmentParams extends AgiloftBaseParams {
  recordId: string
  fieldName: string
  position: string
}

export interface AgiloftRemoveAttachmentResponse extends ToolResponse {
  output: {
    recordId: string
    fieldName: string
    remainingAttachments: number
  }
}

export interface AgiloftGetChoiceLineIdParams extends AgiloftBaseParams {
  fieldName: string
  value: string
}

export interface AgiloftGetChoiceLineIdResponse extends ToolResponse {
  output: {
    choiceLineId: number | null
  }
}

export interface AgiloftRunActionButtonParams extends AgiloftBaseParams {
  recordId: string
  actionButtonField: string
}

export interface AgiloftRunActionButtonResponse extends ToolResponse {
  output: {
    recordId: string
    callbackId: string | null
  }
}

export type AgiloftSavedSearchParams = AgiloftBaseParams

export interface AgiloftSavedSearchResponse extends ToolResponse {
  output: {
    searches: Array<{
      name: string
      label: string
      id: number | null
      description: string | null
    }>
    totalCount: number
  }
}

/**
 * EWTable is knowledge-base scoped: `table` narrows the result to one logical
 * table rather than selecting the target, and is passed as `table` — not
 * `$table` — per the documented example.
 */
export interface AgiloftListTablesParams extends AgiloftCredentials {
  includeLinkedInfo?: boolean
  skipColumnsInfo?: boolean
}

export interface AgiloftTableField {
  columnName: string
  columnLabel: string
  columnType: string
  columnTypeDomain: string
  required: boolean
  isLinked: boolean
  /** Populated only when includeLinkedInfo was requested and the field is linked. */
  linkedInfo: Array<{ linkedTable: string; linkedColumn: string }>
  textFieldType: string | null
}

export interface AgiloftListTablesResponse extends ToolResponse {
  output: {
    tables: Array<{
      label: string
      logicalName: string
      fields: AgiloftTableField[]
    }>
    totalCount: number
  }
}

export interface AgiloftUpsertRecordParams extends AgiloftBaseParams {
  match: string
  data: string
  async?: boolean
}

export interface AgiloftUpsertRecordResponse extends ToolResponse {
  output: {
    id: string | null
    created: boolean
    callbackId: string | null
  }
}

export interface AgiloftAsyncStatusParams extends AgiloftBaseParams {
  callbackId: string
}

export interface AgiloftAsyncStatusResponse extends ToolResponse {
  output: {
    callbackId: string
    statusCode: number
    status: string
    complete: boolean
  }
}

/** EWNLPSearch is KB-scoped; the table comes from the KB's chat-search configuration. */
export interface AgiloftNlpSearchParams extends AgiloftCredentials {
  nlpQuery: string
  fields: string
  page?: string
  limit?: string
}

export interface AgiloftNlpSearchResponse extends ToolResponse {
  output: {
    records: Record<string, unknown>[]
    totalCount: number
    truncated: boolean
  }
}
