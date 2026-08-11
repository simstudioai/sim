import type { ToolResponse } from '@/tools/types'

/**
 * Base parameters shared by all Agiloft tools.
 * Agiloft authenticates via instance URL, KB name, and user credentials.
 */
export interface AgiloftBaseParams {
  instanceUrl: string
  knowledgeBase: string
  login: string
  password: string
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

export interface AgiloftDeleteRecordParams extends AgiloftBaseParams {
  recordId: string
  deleteRule?: AgiloftDeleteRule
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
  }
}

export interface AgiloftSelectResponse extends ToolResponse {
  output: {
    recordIds: string[]
    totalCount: number
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

export type AgiloftSavedSearchParams = Partial<AgiloftBaseParams>

export interface AgiloftSavedSearchResponse extends ToolResponse {
  output: {
    searches: unknown[]
  }
}
