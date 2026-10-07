import { runBenchmarkComparisonContract } from '@/lib/api/contracts/benchmarks'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { requireBenchmarkOperator } from '@/lib/benchmarks/application/access'
import { benchmarkOperations } from '@/lib/benchmarks/application/operations'
import { runBenchmarkComparison } from '@/lib/benchmarks/application/run-comparison'

export const POST = defineInternalJsonRoute({
  contract: runBenchmarkComparisonContract,
  auth: internalSessionAuth,
  operation: benchmarkOperations.compare,
  rateLimit: internalRateLimits.user({
    bucketName: 'benchmark-run',
    config: { maxTokens: 10, refillRate: 2, refillIntervalMs: 60_000 },
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  beforeParse: async ({ principal }) => {
    await requireBenchmarkOperator(principal)
  },
  mapInput: ({ params, body }) => ({
    organizationId: params.id,
    benchmarkId: params.benchmarkId,
    ...body,
  }),
  useCase: runBenchmarkComparison,
})
