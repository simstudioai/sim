import {
  deleteBenchmarkContract,
  getBenchmarkContract,
  updateBenchmarkContract,
} from '@/lib/api/contracts/benchmarks'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { deleteBenchmark, getBenchmark, updateBenchmark } from '@/lib/benchmarks/application/cases'
import { benchmarkOperations } from '@/lib/benchmarks/application/operations'
import { requireBenchmarkEnabled } from '@/lib/benchmarks/config'

export const GET = defineInternalJsonRoute({
  contract: getBenchmarkContract,
  auth: internalSessionAuth,
  operation: benchmarkOperations.read,
  rateLimit: internalRateLimits.none({
    reason: 'The owner polls bounded benchmark artifacts under current source access',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  beforeParse: () => requireBenchmarkEnabled(),
  mapInput: ({ params }) => ({ organizationId: params.id, benchmarkId: params.benchmarkId }),
  useCase: getBenchmark,
})

export const PATCH = defineInternalJsonRoute({
  contract: updateBenchmarkContract,
  auth: internalSessionAuth,
  operation: benchmarkOperations.update,
  rateLimit: internalRateLimits.user({ bucketName: 'benchmark-update' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  beforeParse: () => requireBenchmarkEnabled(),
  mapInput: ({ params, body: { version, ...patch } }) => ({
    organizationId: params.id,
    benchmarkId: params.benchmarkId,
    version,
    patch,
  }),
  useCase: updateBenchmark,
})

export const DELETE = defineInternalJsonRoute({
  contract: deleteBenchmarkContract,
  auth: internalSessionAuth,
  operation: benchmarkOperations.delete,
  rateLimit: internalRateLimits.user({ bucketName: 'benchmark-delete' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  beforeParse: () => requireBenchmarkEnabled(),
  mapInput: ({ params, body }) => ({
    organizationId: params.id,
    benchmarkId: params.benchmarkId,
    version: body.version,
  }),
  useCase: deleteBenchmark,
})
