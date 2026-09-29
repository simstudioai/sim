import { getBenchmarkRunContract, reviewBenchmarkRunContract } from '@/lib/api/contracts/benchmarks'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { requireBenchmarkOperator } from '@/lib/benchmarks/application/access'
import { benchmarkOperations } from '@/lib/benchmarks/application/operations'
import { getBenchmarkRun, reviewBenchmarkRun } from '@/lib/benchmarks/application/runs'

export const GET = defineInternalJsonRoute({
  contract: getBenchmarkRunContract,
  auth: internalSessionAuth,
  operation: benchmarkOperations.readRun,
  rateLimit: internalRateLimits.none({ reason: 'Owner-only bounded benchmark run snapshot' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  beforeParse: async ({ principal }) => {
    await requireBenchmarkOperator(principal)
  },
  mapInput: ({ params }) => ({
    organizationId: params.id,
    benchmarkId: params.benchmarkId,
    runId: params.runId,
  }),
  useCase: getBenchmarkRun,
})

export const PATCH = defineInternalJsonRoute({
  contract: reviewBenchmarkRunContract,
  auth: internalSessionAuth,
  operation: benchmarkOperations.reviewRun,
  rateLimit: internalRateLimits.user({ bucketName: 'benchmark-review' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  beforeParse: async ({ principal }) => {
    await requireBenchmarkOperator(principal)
  },
  mapInput: ({ params, body }) => ({
    organizationId: params.id,
    benchmarkId: params.benchmarkId,
    runId: params.runId,
    ...body,
  }),
  useCase: reviewBenchmarkRun,
})
