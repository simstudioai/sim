import type { ToolResponse } from '@/tools/types'

export interface ServiceNowRecord {
  sys_id: string
  number?: string
  [key: string]: any
}

export interface ServiceNowBaseParams {
  instanceUrl: string
  tableName: string
  authMethod: 'oauth' | 'basic'
  // OAuth fields
  credential?: string
  // Basic Auth fields
  username?: string
  password?: string
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
  fields?: string
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

export interface ServiceNowImportSetParams extends ServiceNowBaseParams {
  records: Array<Record<string, any>>
  transformMap?: string
  batchSize?: number
  importSetId?: string
}

export interface ServiceNowImportSetResponse extends ToolResponse {
  output: {
    importSetId: string
    records: Array<{
      sys_id: string
      status: string
      [key: string]: any
    }>
    metadata: {
      totalRecords: number
      inserted: number
      updated: number
      ignored: number
      errors: number
    }
  }
}

export type ServiceNowResponse =
  | ServiceNowCreateResponse
  | ServiceNowReadResponse
  | ServiceNowUpdateResponse
  | ServiceNowDeleteResponse
  | ServiceNowImportSetResponse

