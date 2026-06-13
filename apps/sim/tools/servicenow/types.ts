import type { ToolResponse } from '@/tools/types'

interface ServiceNowRecord {
  sys_id: string
  number?: string
  [key: string]: any
}

interface ServiceNowBaseParams {
  instanceUrl: string
  username: string
  password: string
  tableName: string
}

export interface ServiceNowCreateParams extends ServiceNowBaseParams {
  fields: Record<string, any>
}

export interface ServiceNowCreateResponse extends ToolResponse {
  output: {
    record: ServiceNowRecord
    metadata: {
      recordCount: 1
    }
  }
}

export interface ServiceNowReadParams extends ServiceNowBaseParams {
  sysId?: string
  number?: string
  query?: string
  limit?: number
  offset?: number
  fields?: string
  displayValue?: string
}

export interface ServiceNowReadResponse extends ToolResponse {
  output: {
    records: ServiceNowRecord[]
    metadata: {
      recordCount: number
    }
  }
}

export interface ServiceNowUpdateParams extends ServiceNowBaseParams {
  sysId: string
  fields: Record<string, any>
}

export interface ServiceNowUpdateResponse extends ToolResponse {
  output: {
    record: ServiceNowRecord
    metadata: {
      recordCount: 1
      updatedFields: string[]
    }
  }
}

export interface ServiceNowDeleteParams extends ServiceNowBaseParams {
  sysId: string
}

export interface ServiceNowDeleteResponse extends ToolResponse {
  output: {
    success: boolean
    metadata: {
      deletedSysId: string
    }
  }
}

export interface ServiceNowAggregateParams extends ServiceNowBaseParams {
  query?: string
  count?: boolean
  groupBy?: string
  avgFields?: string
  sumFields?: string
  minFields?: string
  maxFields?: string
  having?: string
  displayValue?: string
}

export interface ServiceNowAggregateResponse extends ToolResponse {
  output: {
    result: Record<string, any> | Record<string, any>[] | null
    count: number | null
    metadata: {
      grouped: boolean
      groupCount: number | null
    }
  }
}

export interface ServiceNowAttachment {
  sys_id: string
  file_name: string
  content_type: string
  size_bytes?: string
  table_name?: string
  table_sys_id?: string
  download_link?: string
  [key: string]: any
}

export interface ServiceNowListAttachmentsParams {
  instanceUrl: string
  username: string
  password: string
  tableName: string
  recordSysId: string
  limit?: number
}

export interface ServiceNowListAttachmentsResponse extends ToolResponse {
  output: {
    attachments: ServiceNowAttachment[]
    metadata: {
      recordCount: number
    }
  }
}

export interface ServiceNowDownloadAttachmentParams {
  instanceUrl: string
  username: string
  password: string
  attachmentSysId: string
}

export interface ServiceNowDownloadAttachmentResponse extends ToolResponse {
  output: {
    file: {
      name: string
      mimeType: string
      data: string
      size: number
    }
    content: string
  }
}

export interface ServiceNowUploadAttachmentParams {
  instanceUrl: string
  username: string
  password: string
  tableName: string
  recordSysId: string
  fileName: string
  file?: unknown
}

export interface ServiceNowUploadAttachmentResponse extends ToolResponse {
  output: {
    attachment: ServiceNowAttachment
    metadata: {
      recordCount: 1
    }
  }
}

export type ServiceNowResponse =
  | ServiceNowCreateResponse
  | ServiceNowReadResponse
  | ServiceNowUpdateResponse
  | ServiceNowDeleteResponse
  | ServiceNowAggregateResponse
  | ServiceNowListAttachmentsResponse
  | ServiceNowDownloadAttachmentResponse
  | ServiceNowUploadAttachmentResponse
