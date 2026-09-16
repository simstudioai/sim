import { exportKnowledgeBaseContract } from '@/lib/api/contracts/knowledge'
import {
  defineInternalBinaryRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { nodeReadableToWebStream } from '@/lib/core/utils/node-stream'
import { internalKnowledgeErrorPolicies } from '@/lib/knowledge/api/route-policies'
import { exportKnowledgeBase } from '@/lib/knowledge/application/exports'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import {
  buildKnowledgeBundleArchive,
  knowledgeBundleFileName,
} from '@/lib/knowledge/transfer/export-archive'
import { encodeFilenameForHeader } from '@/app/api/files/utils'

/** GET /api/knowledge/[id]/export — stream a knowledge base as a bundle archive. */
export const GET = defineInternalBinaryRoute({
  contract: exportKnowledgeBaseContract,
  auth: internalSessionAuth,
  operation: knowledgeOperations.export,
  rateLimit: internalRateLimits.none({ reason: 'Internal knowledge base bundle download' }),
  errorPolicy: internalKnowledgeErrorPolicies.export,
  mapInput: ({ params, query }) => ({
    knowledgeBaseId: params.id,
    vectors: query.vectors,
  }),
  useCase: exportKnowledgeBase,
  present: (bundle) => ({
    body: nodeReadableToWebStream(buildKnowledgeBundleArchive(bundle)),
    contentType: 'application/zip',
    contentDisposition: `attachment; ${encodeFilenameForHeader(knowledgeBundleFileName(bundle.knowledgeBase.name))}`,
    headers: { 'Cache-Control': 'no-store' },
  }),
})
