import { authorizeComputerUseContract } from '@/lib/api/contracts/computer-use'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { authorizeComputerUse } from '@/lib/computer-use/application/authorize'

export const POST = defineInternalJsonRoute({
  contract: authorizeComputerUseContract,
  auth: internalSessionAuth,
  operation: authorizeComputerUse.operation,
  rateLimit: internalRateLimits.user({ bucketName: 'desktop-computer-use' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ body }) => body,
  useCase: authorizeComputerUse,
  present: (result) => result,
})
