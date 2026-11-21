import type { NextRequest } from 'next/server'
import { legacyCopilotChatAbortContract } from '@/lib/api/contracts/mothership-chats'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { TraceSpan } from '@/lib/mothership/generated/trace-spans-v1'
import { abortRun, runControlOperations } from '@/lib/mothership/request/application/controls'
import { withIncomingGoSpan } from '@/lib/mothership/request/otel'

/**
 * Serves Stop from browser tabs loaded before the abort route moved to
 * `/api/mothership/chat/abort`, with the same policy and use case as that route.
 * Delete this route after the next release.
 */
const handler = defineInternalJsonRoute({
  contract: legacyCopilotChatAbortContract,
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
  withIncomingGoSpan(request.headers, TraceSpan.CopilotChatAbortStream, undefined, () =>
    handler(request, context)
  )
