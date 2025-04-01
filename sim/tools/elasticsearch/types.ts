import { ToolResponse } from '../types'

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

export interface ElasticsearchResponse extends ToolResponse {
  output: {
    result: string
    metadata: string
  }
} 