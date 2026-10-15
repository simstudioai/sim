import { benchmarkWorkspacesContract } from '@/lib/api/contracts/benchmarks'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { benchmarkOperations } from '@/lib/benchmarks/application/operations'
import { listBenchmarkWorkspaces } from '@/lib/benchmarks/application/selection'

export const GET = defineInternalJsonRoute({
  contract: benchmarkWorkspacesContract,
  auth: internalSessionAuth,
  operation: benchmarkOperations.workspaces,
  rateLimit: internalRateLimits.user({ bucketName: 'benchmark-selection' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, query }) => ({ organizationId: params.id, ...query }),
  useCase: listBenchmarkWorkspaces,
})
