import type { ToolResponse } from '@/tools/types'

// Zep v3 Response Type
export interface ZepResponse extends ToolResponse {
  output: {
    // Thread operations
    threadId?: string
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

    // Context operations
    context?: string

    // User operations
    userId?: string
    email?: string
    firstName?: string
    lastName?: string
    metadata?: any

    // Counts
    totalCount?: number
  }
}
