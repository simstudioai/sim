import { listBenchmarkRunsContract } from '@/lib/api/contracts/benchmarks'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { benchmarkOperations } from '@/lib/benchmarks/application/operations'
import { listBenchmarkRuns } from '@/lib/benchmarks/application/runs'
import { requireBenchmarkEnabled } from '@/lib/benchmarks/config'

export const GET = defineInternalJsonRoute({
  contract: listBenchmarkRunsContract,
  auth: internalSessionAuth,
  operation: benchmarkOperations.listRuns,
  rateLimit: internalRateLimits.none({ reason: 'Owner-only paginated benchmark run summaries' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  beforeParse: () => requireBenchmarkEnabled(),
  mapInput: ({ params, query }) => ({
    organizationId: params.id,
    benchmarkId: params.benchmarkId,
    ...query,
  }),
  useCase: listBenchmarkRuns,
})
