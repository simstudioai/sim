import { ToolResponse } from '../../types'

export interface ElasticsearchConnectionConfig {
  node: string
  auth?: {
    username: string
    password: string
  }
  tls?: boolean
  apiKey?: string
  cloud?: {
    id: string
  }
}

export interface ElasticsearchQueryParams {
  connection: ElasticsearchConnectionConfig
  operation: 'search' | 'index' | 'update' | 'delete' | 'create_index' | 'delete_index' | 'get' | 'bulk'
  index: string
  id?: string
  query?: any
  document?: any
  mapping?: any
  documents?: any[]
  options?: {
    timeout?: string
    refresh?: boolean
    waitForCompletion?: boolean
    scroll?: string
  }
}

export interface ElasticsearchResponse {
  success: boolean
  output: {
    result: string
    metadata: string
  }
  error?: string
}

export interface ElasticsearchConnection {
  node: string
  auth?: {
    username: string
    password: string
  }
  tls?: boolean
  cloud?: {
    id: string
    username: string
    password: string
  }
}

export interface ElasticsearchOperation {
  connection: ElasticsearchConnection
  operation: 'search' | 'index' | 'update' | 'delete' | 'get' | 'create_index' | 'delete_index' | 'bulk'
  index: string
  id?: string
  query?: Record<string, any>
  document?: Record<string, any>
  documents?: Record<string, any>[]
  mapping?: Record<string, any>
  options?: Record<string, any>
} 