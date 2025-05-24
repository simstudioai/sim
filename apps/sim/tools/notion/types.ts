import type { ToolResponse } from '../types'

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
    }
  }
}

export interface NotionWriteParams {
  pageId: string
  content: string
  accessToken: string
}

export interface NotionCreatePageParams {
  parentType: 'page' | 'database'
  parentId: string
  title?: string
  properties?: Record<string, any>
  content?: string
  accessToken: string
}

export interface NotionUpdatePageParams {
  pageId: string
  properties: Record<string, any>
  accessToken: string
}
