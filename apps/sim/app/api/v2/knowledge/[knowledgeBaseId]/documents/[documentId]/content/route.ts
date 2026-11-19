import { v2DownloadKnowledgeDocumentContract } from '@/lib/api/contracts/v2/knowledge'
import { defineV2BinaryRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { v2KnowledgeErrorPolicies } from '@/lib/knowledge/api/route-policies'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { readOriginalKnowledgeDocument } from '@/lib/knowledge/application/read-original-document'
import { encodeFilenameForHeader } from '@/lib/uploads/server/delivery'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/v2/knowledge/[knowledgeBaseId]/documents/[documentId]/content — Download a document's
 * original bytes.
 *
 * What `sim workspaces source get` downloads for each document of a knowledge base. A document
 * whose original is not stored (a connector-synced page) answers `NOT_FOUND`. `headSafe: false`
 * because the read pulls the bytes out of object storage.
 */
export const GET = defineV2BinaryRoute({
  contract: v2DownloadKnowledgeDocumentContract,
  auth: v2ApiKeyAuth,
  headSafe: false,
  operation: knowledgeOperations.readDocument,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2KnowledgeErrorPolicies.concealKnowledgeBaseAuthorization,
  mapInput: ({ params, query }) => ({
    knowledgeBaseId: params.knowledgeBaseId,
    documentId: params.documentId,
    assertedWorkspaceId: query.workspaceId,
  }),
  useCase: readOriginalKnowledgeDocument,
  present: (document) => {
    if (!document.sourceAvailable) {
      throw new OrchestrationError('not_found', 'This document has no stored original.')
    }
    return {
      // A view of the read's bytes, not a copy: a Buffer is backed by a plain ArrayBuffer.
      body: new Uint8Array(
        document.buffer.buffer as ArrayBuffer,
        document.buffer.byteOffset,
        document.buffer.byteLength
      ),
      contentType: 'application/octet-stream',
      contentDisposition: `attachment; ${encodeFilenameForHeader(document.name)}`,
      contentLength: document.buffer.byteLength,
    }
  },
})
