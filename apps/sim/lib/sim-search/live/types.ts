import type {
  LiveSearchProvider,
  NativeSearchQuery,
} from '@/lib/api/contracts/mothership-assistant-tools'
import type { LiveSearchPolicy } from '@/lib/sim-search/live/policy-schema'

export interface LiveAccount {
  id: string
  provider: LiveSearchProvider
  providerId: string
  displayName: string
  type:
    | 'oauth'
    | 'managed_oauth'
    | 'personal_token'
    | 'service_account'
    | 'managed_mcp'
    | 'admin_source'
  scopes: string[]
}

export interface NativeDocument {
  /** Server-only GitLab permission evidence from the same response as the content. */
  accessMetadata?: Record<string, unknown>
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
  policy?: LiveSearchPolicy
  query: string
  native?: NativeSearchQuery
  limit: number
  scopes: readonly string[]
}
