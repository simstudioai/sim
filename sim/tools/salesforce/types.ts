import { z } from 'zod'

// Common Salesforce response type
export interface SalesforceResponse<T = any> {
  done: boolean
  totalSize: number
  records: T[]
  nextRecordsUrl?: string
}

// Base Salesforce record type
export interface SalesforceRecord {
  Id: string
  attributes: {
    type: string
    url: string
  }
  [key: string]: any
}

// SOQL Query options
export interface SOQLQueryOptions {
  query: string
  toolchain?: boolean
}

// Bulk API Job Status
export type BulkAPIJobStatus = 'Open' | 'Closed' | 'Aborted' | 'Failed' | 'UploadComplete'

// Bulk API Operation
export type BulkAPIOperation = 'insert' | 'update' | 'upsert' | 'delete' | 'query'

// Bulk API Job
export interface BulkAPIJob {
  id: string
  operation: BulkAPIOperation
  object: string
  state: BulkAPIJobStatus
  createdDate: string
  systemModstamp: string
  contentType: 'CSV'
}

// Record Operation Result
export interface RecordOperationResult {
  id?: string
  success: boolean
  errors: string[]
}

// Zod schema for SOQL query validation
export const soqlQuerySchema = z.object({
  query: z.string().min(1, 'SOQL query is required'),
  toolchain: z.boolean().optional()
})

// Zod schema for record operations
export const recordOperationSchema = z.object({
  objectName: z.string().min(1, 'Object name is required'),
  records: z.array(z.record(z.unknown())).min(1, 'At least one record is required')
})

// Zod schema for bulk API job
export const bulkAPIJobSchema = z.object({
  operation: z.enum(['insert', 'update', 'upsert', 'delete', 'query']),
  object: z.string().min(1, 'Object name is required'),
  contentType: z.literal('CSV'),
  lineEnding: z.enum(['LF', 'CRLF']).optional()
})

// Error types
export class SalesforceError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public errorDetails?: any
  ) {
    super(message)
    this.name = 'SalesforceError'
  }
}

export class SOQLError extends SalesforceError {
  constructor(message: string, details?: any) {
    super(message)
    this.name = 'SOQLError'
    this.errorDetails = details
  }
}

export class BulkAPIError extends SalesforceError {
  constructor(message: string, details?: any) {
    super(message)
    this.name = 'BulkAPIError'
    this.errorDetails = details
  }
} 