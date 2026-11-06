import { v2CreateKnowledgeImportPartUrlsContract } from '@/lib/api/contracts/v2/knowledge'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2KnowledgeErrorPolicies } from '@/lib/knowledge/api/route-policies'
import { createKnowledgeImportParts } from '@/lib/knowledge/application/imports'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const POST = defineV2JsonRoute({
  contract: v2CreateKnowledgeImportPartUrlsContract,
  operation: knowledgeOperations.importParts,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2KnowledgeErrorPolicies.concealImportAuthorization,
  mapInput: ({ params, query, headers, body }) => ({
    importId: params.importId,
    workspaceId: query.workspaceId,
    uploadToken: headers['upload-token'],
    partNumbers: body.partNumbers,
  }),
  useCase: createKnowledgeImportParts,
  present: (result) => ({ data: result }),
})
