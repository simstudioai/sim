import type { WorkspaceSearchFilters } from '@/lib/api/contracts/knowledge'
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
  /**
   * Server-only permission evidence from the same response as the content. Only a verifier
   * bound to the client that produced it may consume it; it is never projected to callers.
   */
  accessMetadata?: Record<string, unknown>
  /**
   * Identifies one item a provider returns from several collections of the same account, such
   * as a meeting on each attendee's calendar. Only the first verified copy is kept.
   */
  dedupeKey?: string
  id: string
  container?: string
  containerName?: string
  containerUrl?: string
  kind?: string
  revision?: string
  threadId?: string
  title: string
  url: string
  content: string
  eventStartAt?: string
  modifiedAt?: string
  author?: string
}

export interface NativePage {
  documents: NativeDocument[]
  /** Continues this exact query and account; implies more results exist. */
  nextCursor?: string
  /** More matches exist beyond this page but cannot be continued through it. */
  hasMore?: boolean
  /** Coverage is degraded: a collection failed, a cap applied, or evidence was dropped. */
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
      /** Reuse this client's earlier response to the same GET instead of requesting it again. */
      memo?: boolean
    }
  ): Promise<unknown>
  text(path: string, query?: Record<string, string>): Promise<string>
}

export interface NativeSearchInput {
  filters?: WorkspaceSearchFilters
  policy?: LiveSearchPolicy
  query: string
  native?: NativeSearchQuery
  limit: number
  scopes: readonly string[]
}
