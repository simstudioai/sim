import type { KnowledgeScope } from '@/lib/api/contracts/knowledge/base'
import type { WorkspaceSearchFilters } from '@/lib/api/contracts/knowledge/search'

/**
 * React Query key factory for knowledge bases.
 *
 * Lives in this standalone (non-`'use client'`) module — like
 * {@link file://./folder-keys.ts} and {@link file://./table-keys.ts} — so a server component
 * or another query module can invalidate knowledge caches without importing
 * `@/hooks/queries/kb/knowledge`, a ~1000-line hook module that pulls the `@sim/emcn` barrel
 * in with it. That import edge is exactly the kind that lands a UI bundle in every workspace
 * route's server prefetch.
 */
export type KnowledgeQueryScope = KnowledgeScope

/** Shared with the server prefetch so a hydrated list and a client fetch never disagree. */
export const KNOWLEDGE_BASE_LIST_STALE_TIME = 60 * 1000

/**
 * `document`, `documents`, `chunks`, `tagDefinitions`, and `tagUsage` all sit UNDER
 * `detail(kb)`, so invalidating `detail` non-exactly refetches all of them at once. A mutation
 * scoped to one document instead invalidates the two keys that actually render it — its own
 * `document` key and the `documentLists` prefix, which are siblings — and, when the base's own
 * totals move, `detail` with `exact: true`.
 */
export const knowledgeKeys = {
  all: ['knowledge'] as const,
  lists: () => [...knowledgeKeys.all, 'list'] as const,
  list: (workspaceId?: string, scope: KnowledgeQueryScope = 'active') =>
    [...knowledgeKeys.lists(), workspaceId ?? 'all', scope] as const,
  details: () => [...knowledgeKeys.all, 'detail'] as const,
  detail: (knowledgeBaseId?: string) =>
    [...knowledgeKeys.details(), knowledgeBaseId ?? ''] as const,
  searches: () => [...knowledgeKeys.all, 'search'] as const,
  search: (workspaceId: string | undefined, query: string, filters?: WorkspaceSearchFilters) =>
    [...knowledgeKeys.searches(), workspaceId ?? '', query, filters ?? {}] as const,
  tagDefinitions: (knowledgeBaseId: string) =>
    [...knowledgeKeys.detail(knowledgeBaseId), 'tagDefinitions'] as const,
  tagUsage: (knowledgeBaseId: string) =>
    [...knowledgeKeys.detail(knowledgeBaseId), 'tagUsage'] as const,
  /**
   * Prefix over every cached page of a base's document list. `documents` and `document` are
   * SIBLINGS, not parent and child — a write to one document does not reach the lists that
   * render its filename, status, tags, and counts unless this key is invalidated too.
   */
  documentLists: (knowledgeBaseId: string) =>
    [...knowledgeKeys.detail(knowledgeBaseId), 'documents'] as const,
  documents: (knowledgeBaseId: string, paramsKey: string) =>
    [...knowledgeKeys.documentLists(knowledgeBaseId), paramsKey] as const,
  /**
   * Prefix over every per-document cache in a base — each `document` entry and
   * the `chunks` / `search` keys nested under it. Needed when a mutation
   * invalidates documents it cannot name, so the alternative would be the
   * `detail` prefix, which also drags in the connector and tag caches.
   */
  documentDetails: (knowledgeBaseId: string) =>
    [...knowledgeKeys.detail(knowledgeBaseId), 'document'] as const,
  document: (knowledgeBaseId: string, documentId: string) =>
    [...knowledgeKeys.documentDetails(knowledgeBaseId), documentId] as const,
  documentTagDefinitions: (knowledgeBaseId: string, documentId: string) =>
    [...knowledgeKeys.document(knowledgeBaseId, documentId), 'tagDefinitions'] as const,
  chunks: (knowledgeBaseId: string, documentId: string, paramsKey: string) =>
    [...knowledgeKeys.document(knowledgeBaseId, documentId), 'chunks', paramsKey] as const,
  chunkSearch: (knowledgeBaseId: string, documentId: string, searchKey: string) =>
    [...knowledgeKeys.document(knowledgeBaseId, documentId), 'search', searchKey] as const,
}
