import type { NextRequest } from 'next/server'
import { copilotChatSteerContract } from '@/lib/api/contracts/copilot'
import {
  defineInternalJsonRoute,
  internalErrorResponse,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { TraceSpan } from '@/lib/mothership/observability/trace-spans'
import {
  runControlOperations,
  SteeringNotQueuedError,
  steerRun,
} from '@/lib/mothership/request/application/controls'
import { withIncomingWorkerSpan } from '@/lib/mothership/request/otel'

const handler = defineInternalJsonRoute({
  contract: copilotChatSteerContract,
  auth: internalSessionAuth,
  operation: runControlOperations.steer,
  rateLimit: internalRateLimits.none({
    reason:
      'Authenticated lifecycle control; Stop and steering must remain available while a run is active.',
  }),
  errorPolicy: {
    project: (error) =>
      error instanceof SteeringNotQueuedError
        ? internalErrorResponse(409, { ok: false, queued: false, workerStatus: error.workerStatus })
        : internalOrchestrationErrorPolicy.project(error),
  },
  mapInput: ({ body }) => body,
  useCase: steerRun,
})

export const POST = (request: NextRequest, context?: Parameters<typeof handler>[1]) =>
  withIncomingWorkerSpan(request.headers, TraceSpan.CopilotChatSteerStream, undefined, () =>
    handler(request, context)
  )
