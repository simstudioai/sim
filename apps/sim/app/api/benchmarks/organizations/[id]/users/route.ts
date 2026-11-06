import { benchmarkUsersContract } from '@/lib/api/contracts/benchmarks'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { benchmarkOperations } from '@/lib/benchmarks/application/operations'
import { listBenchmarkUsers } from '@/lib/benchmarks/application/selection'

export const GET = defineInternalJsonRoute({
  contract: benchmarkUsersContract,
  auth: internalSessionAuth,
  operation: benchmarkOperations.users,
  rateLimit: internalRateLimits.user({ bucketName: 'benchmark-selection' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, query }) => ({ organizationId: params.id, ...query }),
  useCase: listBenchmarkUsers,
})
