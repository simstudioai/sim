import { ToolResponse } from '../types'

// Common types
export interface AirtableRecord {
  id: string
  createdTime: string
  fields: Record<string, any>
}

interface AirtableBaseParams {
  accessToken: string
  baseId: string
  tableId: string
}

// List Records Types
export interface AirtableListParams extends AirtableBaseParams {
  maxRecords?: number
  filterFormula?: string
  // TODO: Add other list parameters like pageSize, offset, view, sort, fields, returnFieldsByFieldId, recordMetadata
}

export interface AirtableListResponse extends ToolResponse {
  output: {
    records: AirtableRecord[]
    metadata: {
      offset?: string
      totalRecords: number
    }
  }
}

// Get Record Types
export interface AirtableGetParams extends AirtableBaseParams {
  recordId: string
}

export interface AirtableGetResponse extends ToolResponse {
  output: {
    record: AirtableRecord
    metadata: {
      recordCount: 1
    }
  }
}

// Create Records Types
export interface AirtableCreateParams extends AirtableBaseParams {
  records: Array<{ fields: Record<string, any> }>
  // TODO: Add typecast parameter
}

export interface AirtableCreateResponse extends ToolResponse {
  output: {
    records: AirtableRecord[]
    metadata: {
      recordCount: number
    }
  }
}

// Update Record Types (Single)
export interface AirtableUpdateParams extends AirtableBaseParams {
  recordId: string
  fields: Record<string, any>
  // TODO: Add typecast parameter
}

export interface AirtableUpdateResponse extends ToolResponse {
  output: {
    record: AirtableRecord // Airtable returns the single updated record
    metadata: {
      recordCount: 1
      updatedFields: string[]
    }
  }
}

// Update Multiple Records Types
export interface AirtableUpdateMultipleParams extends AirtableBaseParams {
  records: Array<{ id: string; fields: Record<string, any> }>
  // TODO: Add typecast, performUpsert parameters
}

export interface AirtableUpdateMultipleResponse extends ToolResponse {
  output: {
    records: AirtableRecord[] // Airtable returns the array of updated records
    metadata: {
      recordCount: number
      updatedRecordIds: string[]
    }
  }
}
