import type { NextRequest } from 'next/server'
import { mothershipChatAbortContract } from '@/lib/api/contracts/mothership-chats'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { TraceSpan } from '@/lib/mothership/observability/trace-spans'
import { abortRun, runControlOperations } from '@/lib/mothership/request/application/controls'
import { withIncomingWorkerSpan } from '@/lib/mothership/request/otel'

const handler = defineInternalJsonRoute({
  contract: mothershipChatAbortContract,
  auth: internalSessionAuth,
  operation: runControlOperations.abort,
  rateLimit: internalRateLimits.none({
    reason:
      'Authenticated lifecycle control; Stop and steering must remain available while a run is active.',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ body }) => body,
  useCase: abortRun,
})

export const POST = (request: NextRequest, context?: Parameters<typeof handler>[1]) =>
  withIncomingWorkerSpan(request.headers, TraceSpan.CopilotChatAbortStream, undefined, () =>
    handler(request, context)
  )
