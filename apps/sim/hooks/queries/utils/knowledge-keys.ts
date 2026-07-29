import type { KnowledgeScope } from '@/lib/api/contracts/knowledge/base'

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

export const knowledgeKeys = {
  all: ['knowledge'] as const,
  lists: () => [...knowledgeKeys.all, 'list'] as const,
  list: (workspaceId?: string, scope: KnowledgeQueryScope = 'active') =>
    [...knowledgeKeys.lists(), workspaceId ?? 'all', scope] as const,
  details: () => [...knowledgeKeys.all, 'detail'] as const,
  detail: (knowledgeBaseId?: string) =>
    [...knowledgeKeys.details(), knowledgeBaseId ?? ''] as const,
  tagDefinitions: (knowledgeBaseId: string) =>
    [...knowledgeKeys.detail(knowledgeBaseId), 'tagDefinitions'] as const,
  tagUsage: (knowledgeBaseId: string) =>
    [...knowledgeKeys.detail(knowledgeBaseId), 'tagUsage'] as const,
  documents: (knowledgeBaseId: string, paramsKey: string) =>
    [...knowledgeKeys.detail(knowledgeBaseId), 'documents', paramsKey] as const,
  document: (knowledgeBaseId: string, documentId: string) =>
    [...knowledgeKeys.detail(knowledgeBaseId), 'document', documentId] as const,
  documentTagDefinitions: (knowledgeBaseId: string, documentId: string) =>
    [...knowledgeKeys.document(knowledgeBaseId, documentId), 'tagDefinitions'] as const,
  chunks: (knowledgeBaseId: string, documentId: string, paramsKey: string) =>
    [...knowledgeKeys.document(knowledgeBaseId, documentId), 'chunks', paramsKey] as const,
  chunkSearch: (knowledgeBaseId: string, documentId: string, searchKey: string) =>
    [...knowledgeKeys.document(knowledgeBaseId, documentId), 'search', searchKey] as const,
}
