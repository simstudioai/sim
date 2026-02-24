import type { OutputProperty, ToolResponse } from '@/tools/types'

/**
 * Shared output property definitions for Attio API responses.
 * Based on Attio REST API v2 documentation.
 * @see https://developers.attio.com/reference
 */

/**
 * Common record value properties returned by Attio API.
 * Each attribute value has a type and value fields.
 */
export const RECORD_VALUE_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Record attribute value with type and data',
  properties: {
    active_from: { type: 'string', description: 'Timestamp when value became active' },
    active_until: {
      type: 'string',
      description: 'Timestamp when value became inactive',
      optional: true,
    },
    created_by_actor: {
      type: 'object',
      description: 'Actor who created this value',
      properties: {
        type: { type: 'string', description: 'Actor type (e.g., api-token, user, system)' },
        id: { type: 'string', description: 'Actor ID', optional: true },
      },
    },
    attribute_type: {
      type: 'string',
      description: 'Attribute type (e.g., text, number, email-address)',
    },
  },
}

/**
 * Record ID properties
 */
export const RECORD_ID_OUTPUT_PROPERTIES = {
  workspace_id: { type: 'string', description: 'Workspace ID' },
  object_id: {
    type: 'string',
    description: 'Object ID (e.g., people, companies, or custom object)',
  },
  record_id: { type: 'string', description: 'Unique record ID' },
} as const satisfies Record<string, OutputProperty>

/**
 * Record object output definition
 */
export const RECORD_OBJECT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Attio record object',
  properties: {
    id: {
      type: 'object',
      description: 'Record identifiers',
      properties: RECORD_ID_OUTPUT_PROPERTIES,
    },
    created_at: { type: 'string', description: 'Record creation timestamp (ISO 8601)' },
    values: {
      type: 'object',
      description: 'Record attribute values as key-value pairs',
    },
  },
}

/**
 * Records array output definition
 */
export const RECORDS_ARRAY_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Array of Attio record objects',
  items: {
    type: 'object',
    properties: {
      id: {
        type: 'object',
        description: 'Record identifiers',
        properties: RECORD_ID_OUTPUT_PROPERTIES,
      },
      created_at: { type: 'string', description: 'Record creation timestamp (ISO 8601)' },
      values: {
        type: 'object',
        description: 'Record attribute values',
      },
    },
  },
}

/**
 * Paging output properties for list endpoints.
 */
export const PAGING_OUTPUT_PROPERTIES = {
  offset: { type: 'number', description: 'Current offset in the result set' },
  limit: { type: 'number', description: 'Maximum number of records returned' },
  total: { type: 'number', description: 'Total number of matching records', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete paging object output definition.
 */
export const PAGING_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Pagination information for fetching more results',
  optional: true,
  properties: PAGING_OUTPUT_PROPERTIES,
}

/**
 * Metadata output properties for list endpoints.
 */
export const METADATA_OUTPUT_PROPERTIES = {
  totalReturned: { type: 'number', description: 'Number of records returned in this response' },
  hasMore: { type: 'boolean', description: 'Whether more records are available' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete metadata object output definition.
 */
export const METADATA_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Response metadata',
  properties: METADATA_OUTPUT_PROPERTIES,
}

// Attio record type
export interface AttioRecord {
  id: {
    workspace_id: string
    object_id: string
    record_id: string
  }
  created_at: string
  values: Record<string, any[]>
}

export interface AttioPaging {
  offset: number
  limit: number
  total?: number
}

// List Records
export interface AttioListRecordsResponse extends ToolResponse {
  output: {
    records: AttioRecord[]
    paging?: AttioPaging
    metadata: {
      totalReturned: number
      hasMore: boolean
    }
    success: boolean
  }
}

export interface AttioListRecordsParams {
  accessToken: string
  object: string
  limit?: number
  offset?: number
  attributes?: string[]
}

// Get Record
export interface AttioGetRecordResponse extends ToolResponse {
  output: {
    record: AttioRecord
    recordId: string
    success: boolean
  }
}

export interface AttioGetRecordParams {
  accessToken: string
  object: string
  recordId: string
}

// Create Record
export interface AttioCreateRecordResponse extends ToolResponse {
  output: {
    record: AttioRecord
    recordId: string
    success: boolean
  }
}

export interface AttioCreateRecordParams {
  accessToken: string
  object: string
  values: Record<string, any>
}

// Update Record
export interface AttioUpdateRecordResponse extends ToolResponse {
  output: {
    record: AttioRecord
    recordId: string
    success: boolean
  }
}

export interface AttioUpdateRecordParams {
  accessToken: string
  object: string
  recordId: string
  values: Record<string, any>
}

// Search Records
export interface AttioSearchRecordsResponse extends ToolResponse {
  output: {
    records: AttioRecord[]
    total?: number
    paging?: AttioPaging
    metadata: {
      totalReturned: number
      hasMore: boolean
    }
    success: boolean
  }
}

export interface AttioSearchRecordsParams {
  accessToken: string
  query: string
  objects?: string[]
  limit?: number
}

// Generic Attio response type for the block
export type AttioResponse =
  | AttioListRecordsResponse
  | AttioGetRecordResponse
  | AttioCreateRecordResponse
  | AttioUpdateRecordResponse
  | AttioSearchRecordsResponse
