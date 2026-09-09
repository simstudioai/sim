import { readSearchSourceProgressContract } from '@/lib/api/contracts/knowledge/connectors'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalKnowledgeErrorPolicies } from '@/lib/knowledge/api/route-policies'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { readSearchSourceProgress } from '@/lib/knowledge/application/search-source-progress'

export const POST = defineInternalJsonRoute({
  contract: readSearchSourceProgressContract,
  auth: internalSessionAuth,
  operation: knowledgeOperations.readSearchSourceProgress,
  rateLimit: internalRateLimits.none({
    reason: 'Bounded viewer-authorized indexing progress polling',
  }),
  errorPolicy: internalKnowledgeErrorPolicies.connectors,
  mapInput: ({ body }) => body,
  useCase: readSearchSourceProgress,
  present: ({ sources }) => ({ success: true as const, data: sources }),
  staticResponseHeaders: { 'Cache-Control': 'private, no-store' },
})
