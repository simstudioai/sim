import { v2ExportKnowledgeBaseContract } from '@/lib/api/contracts/v2/knowledge'
import { defineV2BinaryRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { nodeReadableToWebStream } from '@/lib/core/utils/node-stream'
import { v2KnowledgeErrorPolicies } from '@/lib/knowledge/api/route-policies'
import { exportKnowledgeBase } from '@/lib/knowledge/application/exports'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import {
  buildKnowledgeBundleArchive,
  knowledgeBundleFileName,
} from '@/lib/knowledge/transfer/export-archive'
import { encodeFilenameForHeader } from '@/app/api/files/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/v2/knowledge/[knowledgeBaseId]/export — stream a knowledge base as a bundle archive.
 *
 * `headSafe: false` because the export records a `KNOWLEDGE_BASE_EXPORTED`
 * audit event and pulls bytes out of object storage.
 */
export const GET = defineV2BinaryRoute({
  contract: v2ExportKnowledgeBaseContract,
  auth: v2ApiKeyAuth,
  headSafe: false,
  operation: knowledgeOperations.export,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2KnowledgeErrorPolicies.concealKnowledgeBaseAuthorization,
  mapInput: ({ params, query }) => ({
    knowledgeBaseId: params.knowledgeBaseId,
    assertedWorkspaceId: query.workspaceId,
    vectors: query.vectors,
  }),
  useCase: exportKnowledgeBase,
  present: (bundle) => ({
    body: nodeReadableToWebStream(buildKnowledgeBundleArchive(bundle)),
    contentType: 'application/zip',
    contentDisposition: `attachment; ${encodeFilenameForHeader(knowledgeBundleFileName(bundle.knowledgeBase.name))}`,
  }),
})
