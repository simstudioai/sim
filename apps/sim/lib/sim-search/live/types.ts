import type { WorkspaceSearchFilters } from '@/lib/api/contracts/knowledge'
import type {
  LiveSearchProvider,
  NativeSearchQuery,
} from '@/lib/api/contracts/mothership-assistant-tools'
import type { LiveSearchPolicy } from '@/lib/sim-search/live/policy-schema'
import type { TextMatch } from '@/lib/sim-search/live/text-match'

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

export type NativeAccessReference = Pick<NativeDocument, 'id' | 'container' | 'kind'>

export interface NativeReadOptions {
  policy: LiveSearchPolicy
  filters?: WorkspaceSearchFilters
  signal: AbortSignal
  verify(
    reference: NativeAccessReference & Pick<NativeDocument, 'accessMetadata'>
  ): Promise<boolean>
}

export interface NativeDocument {
  /** Server-only references whose content must pass a fresh check before projection. */
  accessDependencies?: readonly NativeAccessReference[]
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
  /** Provider folder references are navigation hints, not readable document identities. */
  folders?: { id: string; name: string }[]
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
      /** Cancels this request alongside the client's own signal. */
      signal?: AbortSignal
    }
  ): Promise<unknown>
  text(path: string, query?: Record<string, string>): Promise<string>
  bytes(path: string, query?: Record<string, string>): Promise<Buffer>
}

export interface NativeSearchInput {
  filters?: WorkspaceSearchFilters
  policy?: LiveSearchPolicy
  query: string
  native?: NativeSearchQuery
  limit: number
  scopes: readonly string[]
  /** How a plain query's words must match; providers without full-text search ignore it. */
  textMatch?: TextMatch
  /**
   * Cancels this search's provider requests alongside the client's own signal. Honored by the
   * providers that run the any-term fallback, so its budget stops the request itself.
   */
  signal?: AbortSignal
}
