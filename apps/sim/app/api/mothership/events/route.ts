/**
 * SSE endpoint for task status events.
 *
 * Pushes `task_status` events to the browser when tasks are
 * started, completed, created, deleted, or renamed.
 *
 * Auth is handled via session cookies (EventSource sends cookies automatically).
 */

import { createLogger } from '@sim/logger'
import type { NextRequest } from 'next/server'
import { mothershipEventsQuerySchema } from '@/lib/api/contracts/mothership-chats'
import { validationErrorResponse } from '@/lib/api/server'
import {
  InternalUnauthenticatedError,
  internalSessionAuth,
} from '@/lib/api/server/routes/internal-json-route'
import { authorizeOrganizationChatEvents } from '@/lib/copilot/chat/organization-chats'
import { chatPubSub } from '@/lib/copilot/chat-status'
import { isChatEnabled } from '@/lib/core/config/env-flags'
import { asOrchestrationError } from '@/lib/core/orchestration/types'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createSSEStream, createWorkspaceSSE } from '@/lib/events/sse-endpoint'

export const dynamic = 'force-dynamic'

const logger = createLogger('MothershipEvents')

const mothershipEventsHandler = createWorkspaceSSE({
  label: 'mothership-events',
  subscriptions: [
    {
      subscribe: (workspaceId, send) => {
        if (!chatPubSub) return () => {}
        return chatPubSub.onStatusChanged((event) => {
          if (event.workspaceId !== workspaceId) return
          send('task_status', {
            chatId: event.chatId,
            type: event.type,
            ...(event.streamId ? { streamId: event.streamId } : {}),
            timestamp: Date.now(),
          })
        })
      },
    },
  ],
})

export const GET = withRouteHandler(async (request: NextRequest) => {
  // Closes streams held by tabs that were open when Chat was turned off; the
  // client hook already declines to open new ones.
  if (!isChatEnabled) return new Response(null, { status: 404 })

  try {
    const principal = await internalSessionAuth.authenticate()
    const validation = mothershipEventsQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams.entries())
    )
    if (!validation.success) return validationErrorResponse(validation.error)
    const { organizationId } = validation.data
    if (!organizationId) return mothershipEventsHandler(request, principal)

    const revalidate = async () => {
      await authorizeOrganizationChatEvents.execute({ principal, input: { organizationId } })
    }
    await revalidate()
    return createSSEStream(request, {
      label: 'mothership-organization-events',
      revalidate,
      subscriptions: [
        {
          subscribe: (send) =>
            chatPubSub?.onStatusChanged((event) => {
              if (event.organizationId !== organizationId || event.userId !== principal.userId)
                return
              send('task_status', {
                chatId: event.chatId,
                type: event.type,
                ...(event.streamId ? { streamId: event.streamId } : {}),
                timestamp: Date.now(),
              })
            }) ?? (() => {}),
        },
      ],
    })
  } catch (error) {
    const code = asOrchestrationError(error)?.code
    if (code === 'not_found' || code === 'forbidden')
      return new Response('Organization access denied', { status: 403 })
    if (error instanceof InternalUnauthenticatedError)
      return new Response('Unauthorized', { status: 401 })
    logger.error('Failed to subscribe to organization chats', error)
    return new Response('Unable to subscribe to chats', { status: 500 })
  }
})
