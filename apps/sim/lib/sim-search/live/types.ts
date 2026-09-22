import type {
  LiveSearchProvider,
  NativeSearchQuery,
} from '@/lib/api/contracts/mothership-assistant-tools'

export interface LiveAccount {
  id: string
  provider: LiveSearchProvider
  providerId: string
  displayName: string
  type: 'oauth' | 'managed_oauth' | 'personal_token' | 'service_account' | 'managed_mcp'
  scopes: string[]
}

export interface NativeDocument {
  id: string
  container?: string
  kind?: string
  revision?: string
  title: string
  url: string
  content: string
  modifiedAt?: string
  author?: string
}

export interface NativePage {
  documents: NativeDocument[]
  nextCursor?: string
  partial?: boolean
  message?: string
}

export interface NativeClient {
  json(
    path: string,
    options?: {
      query?: Record<string, string | string[]>
      body?: unknown
      googleService?: 'sheets'
    }
  ): Promise<unknown>
  text(path: string, query?: Record<string, string>): Promise<string>
}

export interface NativeSearchInput {
  query: string
  native?: NativeSearchQuery
  limit: number
  scopes: readonly string[]
}
