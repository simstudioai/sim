import type { ToolResponse } from '@/tools/types'

export interface ServiceNowRecord {
  sys_id: string
  number?: string
  [key: string]: any
}

export interface ServiceNowBaseParams {
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

export type ServiceNowResponse =
  | ServiceNowCreateResponse
  | ServiceNowReadResponse
  | ServiceNowUpdateResponse
  | ServiceNowDeleteResponse
