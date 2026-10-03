import { type ErrorResponseId, RATE_LIMIT_HEADERS } from '@/lib/api/contracts/v2/openapi/shared'
import type { OpenApiOperationMetadata, OpenApiSuccessMetadata } from '@/lib/api/openapi/types'

/**
 * Shared pieces of the knowledge OpenAPI document.
 *
 * The document is composed from three modules — knowledge bases and documents,
 * chunks, and tag definitions — and every operation in all three has to publish
 * the same tag and the same rate-limit headers. Holding the helper here rather
 * than in one of the modules keeps the composition acyclic.
 */

export const KNOWLEDGE_WORKSPACE_ID = 'a91c4b2e-6d3f-4e8a-b5c7-0d9e2f1a8c64'
export const KNOWLEDGE_BASE_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
export const KNOWLEDGE_DOCUMENT_ID = 'b2d4f8a0-1c3e-4a5b-9d7c-2e6f0a8b4c12'
export const KNOWLEDGE_CHUNK_ID = '4c1f9e77-2b3a-4f8d-9e10-6a2c8d4b1e05'
export const KNOWLEDGE_TAG_ID = '3f0d2b18-9a41-4d6e-8c52-1b7e5a0f9c34'

export function knowledgeOperation(
  operation: Omit<OpenApiOperationMetadata, 'tags' | 'success' | 'errors'> & {
    errors: readonly ErrorResponseId[]
    success: OpenApiSuccessMetadata
  }
): OpenApiOperationMetadata {
  return {
    ...operation,
    tags: ['Knowledge Bases'],
    success: {
      ...operation.success,
      headers: [...(operation.success.headers ?? []), ...RATE_LIMIT_HEADERS],
    },
  }
}
