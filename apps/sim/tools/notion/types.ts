import type { ToolResponse } from '@/tools/types'

export interface NotionReadParams {
  pageId: string
  accessToken: string
}

export interface NotionResponse extends ToolResponse {
  output: {
    content: string
    metadata?: {
      title?: string
      lastEditedTime?: string
      createdTime?: string
      url?: string
      // Additional metadata for query/search operations
      totalResults?: number
      hasMore?: boolean
      nextCursor?: string | null
      results?: any[]
      // Additional metadata for create operations
      id?: string
      properties?: Record<string, any>
    }
  }
}

export interface NotionWriteParams {
  pageId: string
  content: string
  accessToken: string
}

export interface NotionCreatePageParams {
  parentId: string
  title?: string
  content?: string
  accessToken: string
}

export interface NotionUpdatePageParams {
  pageId: string
  properties: Record<string, any>
  accessToken: string
}

export interface NotionQueryDatabaseParams {
  databaseId: string
  filter?: string
  sorts?: string
  pageSize?: number
  accessToken: string
}

export interface NotionSearchParams {
  query?: string
  filterType?: string
  pageSize?: number
  accessToken: string
}

export interface NotionCreateDatabaseParams {
  parentId: string
  title: string
  properties?: string
  accessToken: string
}

export interface NotionReadDatabaseParams {
  databaseId: string
  accessToken: string
}
