import { v2CompleteKnowledgeImportContract } from '@/lib/api/contracts/v2/knowledge'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2KnowledgeErrorPolicies } from '@/lib/knowledge/api/route-policies'
import { completeKnowledgeImport } from '@/lib/knowledge/application/imports'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { presentV2KnowledgeImport } from '@/app/api/v2/knowledge/imports/presenters'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const POST = defineV2JsonRoute({
  contract: v2CompleteKnowledgeImportContract,
  operation: knowledgeOperations.importComplete,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2KnowledgeErrorPolicies.concealImportAuthorization,
  mapInput: ({ params, query, headers }) => ({
    importId: params.importId,
    workspaceId: query.workspaceId,
    uploadToken: headers['upload-token'],
  }),
  useCase: completeKnowledgeImport,
  present: presentV2KnowledgeImport,
})
