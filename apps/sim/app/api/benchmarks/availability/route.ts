import { benchmarkAvailabilityContract } from '@/lib/api/contracts/benchmarks'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { benchmarkOperations } from '@/lib/benchmarks/application/operations'
import { benchmarkAvailability } from '@/lib/benchmarks/application/selection'

export const GET = defineInternalJsonRoute({
  contract: benchmarkAvailabilityContract,
  auth: internalSessionAuth,
  operation: benchmarkOperations.availability,
  rateLimit: internalRateLimits.user({ bucketName: 'benchmark-selection' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: () => ({}),
  useCase: benchmarkAvailability,
})
