import { createBenchmarkContract, listBenchmarksContract } from '@/lib/api/contracts/benchmarks'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { requireBenchmarkOperator } from '@/lib/benchmarks/application/access'
import { createBenchmark, listBenchmarks } from '@/lib/benchmarks/application/cases'
import { benchmarkOperations } from '@/lib/benchmarks/application/operations'

export const GET = defineInternalJsonRoute({
  contract: listBenchmarksContract,
  auth: internalSessionAuth,
  operation: benchmarkOperations.list,
  rateLimit: internalRateLimits.none({
    reason: 'Private benchmark metadata uses bounded pagination under current membership',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  beforeParse: async ({ principal }) => {
    await requireBenchmarkOperator(principal)
  },
  mapInput: ({ params, query }) => ({ organizationId: params.id, ...query }),
  useCase: listBenchmarks,
})

export const POST = defineInternalJsonRoute({
  contract: createBenchmarkContract,
  auth: internalSessionAuth,
  operation: benchmarkOperations.create,
  rateLimit: internalRateLimits.user({ bucketName: 'benchmark-create' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  beforeParse: async ({ principal }) => {
    await requireBenchmarkOperator(principal)
  },
  mapInput: ({ params, body }) => ({ organizationId: params.id, ...body }),
  useCase: createBenchmark,
})
