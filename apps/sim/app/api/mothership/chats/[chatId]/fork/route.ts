import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { forkMothershipChatContract } from '@/lib/api/contracts/mothership-chats'
import { parseRequest } from '@/lib/api/server'
import { asOrchestrationError } from '@/lib/core/orchestration/types'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { forkChat } from '@/lib/mothership/chat/application/fork'
import {
  authenticateCopilotRequestSessionOnly,
  createBadRequestResponse,
  createInternalServerErrorResponse,
  createUnauthorizedResponse,
} from '@/lib/mothership/request/http'

const logger = createLogger('ForkChatAPI')

/** Forks an owned conversation through the canonical owner-authorized application operation. */
export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ chatId: string }> }) => {
    try {
      const { principal, isAuthenticated } = await authenticateCopilotRequestSessionOnly()
      if (!isAuthenticated || !principal) return createUnauthorizedResponse()
      const parsed = await parseRequest(forkMothershipChatContract, request, context, {
        validationErrorResponse: () => createBadRequestResponse('upToMessageId is required'),
      })
      if (!parsed.success) return parsed.response
      return NextResponse.json(
        await forkChat.execute({
          principal,
          input: {
            chatId: parsed.data.params.chatId,
            upToMessageId: parsed.data.body.upToMessageId,
          },
        })
      )
    } catch (error) {
      const classified = asOrchestrationError(error)
      if (classified?.code === 'not_found' || classified?.code === 'forbidden')
        return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
      if (classified?.code === 'validation') return createBadRequestResponse(classified.message)
      logger.error('Error forking chat:', error)
      return createInternalServerErrorResponse('Failed to fork chat')
    }
  }
)
