import { ToolResponse } from '../types'

// Common interfaces
interface AirtableRecord {
  id: string
  createdTime: string
  fields: Record<string, any>
}

interface AirtableError {
  type: string
  message: string
}

// Response interfaces
export interface AirtableReadResponse extends ToolResponse {
  output: {
    records: AirtableRecord[]
    metadata: {
      offset?: string
      totalRecords?: number
    }
  }
}

export interface AirtableWriteResponse extends ToolResponse {
  output: {
    records: AirtableRecord[]
    metadata: {
      recordCount: number
    }
  }
}

export interface AirtableUpdateResponse extends ToolResponse {
  output: {
    records: AirtableRecord[]
    metadata: {
      recordCount: number
      updatedFields: string[]
    }
  }
}

// Request interfaces
export interface AirtableReadParams {
  accessToken: string
  baseId: string
  tableId: string
  maxRecords?: number
  filterFormula?: string
}

export interface AirtableWriteParams {
  accessToken: string
  baseId: string
  tableId: string
  records: Array<{
    fields: Record<string, any>
  }>
}

export interface AirtableUpdateParams {
  accessToken: string
  baseId: string
  tableId: string
  recordId: string
  fields: Record<string, any>
} 