import { runBenchmarkStageContract } from '@/lib/api/contracts/benchmarks'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { benchmarkOperations } from '@/lib/benchmarks/application/operations'
import { runBenchmarkStage } from '@/lib/benchmarks/application/run-stage'
import { requireBenchmarkEnabled } from '@/lib/benchmarks/config'

export const maxDuration = 660

export const POST = defineInternalJsonRoute({
  contract: runBenchmarkStageContract,
  auth: internalSessionAuth,
  operation: benchmarkOperations.run,
  rateLimit: internalRateLimits.user({
    bucketName: 'benchmark-run',
    config: { maxTokens: 10, refillRate: 2, refillIntervalMs: 60_000 },
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  beforeParse: () => requireBenchmarkEnabled(),
  mapInput: ({ params, body }) => ({
    organizationId: params.id,
    benchmarkId: params.benchmarkId,
    ...body,
  }),
  useCase: runBenchmarkStage,
})
