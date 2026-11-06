import { benchmarkOrganizationsContract } from '@/lib/api/contracts/benchmarks'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { benchmarkOperations } from '@/lib/benchmarks/application/operations'
import { listBenchmarkOrganizations } from '@/lib/benchmarks/application/selection'

export const GET = defineInternalJsonRoute({
  contract: benchmarkOrganizationsContract,
  auth: internalSessionAuth,
  operation: benchmarkOperations.organizations,
  rateLimit: internalRateLimits.user({ bucketName: 'benchmark-selection' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ query }) => query,
  useCase: listBenchmarkOrganizations,
})
