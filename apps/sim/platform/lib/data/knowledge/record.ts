'use client'

import { isApiClientError } from '@/lib/api/client/errors'
import { useDocumentQuery, useKnowledgeBaseQuery } from '@/hooks/queries/kb/knowledge'
import { queryRead } from '@/platform/shared/workspace-records'

/** A knowledge base's read for its page. A base that no longer exists reads as missing rather than failed. */
export function useKnowledgeBaseRecord(knowledgeBaseId: string) {
  const query = useKnowledgeBaseQuery(knowledgeBaseId)
  return {
    missing: isApiClientError(query.error) && query.error.status === 404,
    read: queryRead(query, 'This knowledge base could not be loaded.'),
  }
}

/** A document's read for its page. A document that no longer exists reads as missing rather than failed. */
export function useDocumentRecord(knowledgeBaseId: string, documentId: string) {
  const query = useDocumentQuery(knowledgeBaseId, documentId)
  return {
    missing: isApiClientError(query.error) && query.error.status === 404,
    read: queryRead(query, 'This document could not be loaded.'),
  }
}
