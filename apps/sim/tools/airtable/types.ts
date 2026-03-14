import type { ToolResponse } from '@/tools/types'

// Common types
export interface AirtableRecord {
  id: string
  createdTime: string
  fields: Record<string, any>
}

export interface AirtableBase {
  id: string
  name: string
  permissionLevel: 'none' | 'read' | 'comment' | 'edit' | 'create'
}

export interface AirtableFieldOption {
  id: string
  name: string
  color?: string
}

export interface AirtableField {
  id: string
  name: string
  type: string
  description?: string
  options?: {
    choices?: AirtableFieldOption[]
    linkedTableId?: string
    isReversed?: boolean
    prefersSingleRecordLink?: boolean
    inverseLinkFieldId?: string
    [key: string]: unknown
  }
}

export interface AirtableTable {
  id: string
  name: string
  description?: string
  primaryFieldId: string
  fields: AirtableField[]
}

export interface AirtableView {
  id: string
  name: string
  type: string
}

interface AirtableBaseParams {
  accessToken: string
  baseId: string
  tableId: string
}

// List Bases Types
export interface AirtableListBasesParams {
  accessToken: string
  offset?: string
}

export interface AirtableListBasesResponse extends ToolResponse {
  output: {
    bases: AirtableBase[]
    metadata: {
      offset?: string
      totalBases: number
    }
  }
}

// List Tables Types (Get Base Schema)
export interface AirtableListTablesParams {
  accessToken: string
  baseId: string
}

export interface AirtableListTablesResponse extends ToolResponse {
  output: {
    tables: AirtableTable[]
    metadata: {
      baseId: string
      totalTables: number
    }
  }
}

// List Records Types
export interface AirtableListParams extends AirtableBaseParams {
  maxRecords?: number
  filterFormula?: string
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

export type AirtableResponse =
  | AirtableListBasesResponse
  | AirtableListTablesResponse
  | AirtableListResponse
  | AirtableGetResponse
  | AirtableCreateResponse
  | AirtableUpdateResponse
  | AirtableUpdateMultipleResponse
  | AirtableListBasesResponse
  | AirtableGetBaseSchemaResponse

export interface AirtableGetBaseSchemaResponse extends ToolResponse {
  output: {
    tables: Array<{
      id: string
      name: string
      description?: string
      fields: Array<{ id: string; name: string; type: string; description?: string }>
      views: Array<{ id: string; name: string; type: string }>
    }>
    metadata: { totalTables: number }
  }
}
