import { v2CreateKnowledgeImportContract } from '@/lib/api/contracts/v2/knowledge'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2KnowledgeErrorPolicies } from '@/lib/knowledge/api/route-policies'
import { createKnowledgeImport } from '@/lib/knowledge/application/imports'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { presentV2CreateKnowledgeImport } from '@/app/api/v2/knowledge/imports/presenters'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const POST = defineV2JsonRoute({
  contract: v2CreateKnowledgeImportContract,
  operation: knowledgeOperations.importCreate,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2KnowledgeErrorPolicies.usage,
  mapInput: ({ body }) => ({ body }),
  useCase: createKnowledgeImport,
  present: presentV2CreateKnowledgeImport,
})
