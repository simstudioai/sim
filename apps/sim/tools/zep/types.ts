import type { ToolResponse } from '@/tools/types'

// Zep v3 Response Type
export interface ZepResponse extends ToolResponse {
  output: {
    // Thread operations
    threadId?: string
    userId?: string
    uuid?: string
    createdAt?: string
    updatedAt?: string
    projectUuid?: string
    threads?: any[]
    deleted?: boolean

    // Message operations
    messages?: any[]
    messageIds?: string[]
    added?: boolean
    batchId?: string

    // Context operations
    context?: string
    facts?: any[]
    entities?: any[]
    summary?: string

    // User operations
    email?: string
    firstName?: string
    lastName?: string
    metadata?: any

    // Pagination
    responseCount?: number
    totalCount?: number
    rowCount?: number

    // Search results (if needed in future)
    searchResults?: any[]
  }
}
