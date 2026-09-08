import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { AnyApiRouteContract, ContractBody } from '@/lib/api/contracts'
import {
  slackAddReactionContract,
  slackDeleteMessageContract,
  slackDownloadContract,
  slackReadMessagesContract,
  slackRemoveReactionContract,
  slackSendEphemeralContract,
  slackSendMessageContract,
  slackUpdateMessageContract,
} from '@/lib/api/contracts/tools/communication/slack'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { SlackOperationError } from '@/lib/internal/slack/errors'
import {
  executeSlackAddReaction,
  executeSlackDeleteMessage,
  executeSlackDownload,
  executeSlackReadMessages,
  executeSlackRemoveReaction,
  executeSlackSendEphemeral,
  executeSlackSendMessage,
  executeSlackUpdateMessage,
  type SlackOperationContext,
} from '@/lib/internal/slack/operations'
import { executeSlackGetChannelHistoryOperation } from '@/lib/internal/slack/operations/get-channel-history'
import { executeSlackGetThreadRepliesOperation } from '@/lib/internal/slack/operations/get-thread-replies'
import { executeSlackListConversationsOperation } from '@/lib/internal/slack/operations/list-conversations'
import { executeToolOperationImplementation } from '@/lib/internal/tool-operations/execute'
import { parseInternalToolInput } from '@/lib/internal/tool-operations/parse-input'
import type {
  InternalToolOperationCall,
  InternalToolOperationHandler,
} from '@/lib/internal/tool-operations/types'
import { docNotReadyResponse } from '@/lib/uploads/utils/servable-file-response'

const logger = createLogger('SlackToolExecution')

async function executeOperation<C extends AnyApiRouteContract>(
  contract: C,
  request: InternalToolOperationCall,
  execute: (input: ContractBody<C>) => Promise<unknown>
): Promise<Response> {
  request.signal?.throwIfAborted()
  const parsed = parseInternalToolInput(contract, request.input)
  if (!parsed.success) return parsed.response
  try {
    const result = await execute(parsed.data)
    request.signal?.throwIfAborted()
    return Response.json(result)
  } catch (error) {
    request.signal?.throwIfAborted()
    if (error instanceof SlackOperationError) {
      return Response.json(error.body, { status: error.status })
    }
    const notReady = docNotReadyResponse(error)
    if (notReady) return notReady
    const message = getErrorMessage(error, 'Unknown error occurred')
    logger.error('Slack operation failed', {
      error: message,
      requestId: request.requestId,
      toolId: request.toolId,
    })
    return Response.json(
      { success: false, error: message },
      {
        status: isPayloadSizeLimitError(error) && request.toolId === 'slack_download' ? 413 : 500,
      }
    )
  }
}

export const executeSlackTool: InternalToolOperationHandler = async (request) => {
  const context: SlackOperationContext = {
    requestId: request.requestId,
    signal: request.signal,
    userId: request.context.userId,
  }

  switch (request.toolId) {
    case 'slack_add_reaction':
      return executeOperation(slackAddReactionContract, request, (input) =>
        executeSlackAddReaction(input, request.signal)
      )
    case 'slack_delete_message':
      return executeOperation(slackDeleteMessageContract, request, (input) =>
        executeSlackDeleteMessage(input, request.signal)
      )
    case 'slack_download':
      return executeOperation(slackDownloadContract, request, (input) =>
        executeSlackDownload(input, request.signal)
      )
    case 'slack_get_channel_history':
      return executeToolOperationImplementation(executeSlackGetChannelHistoryOperation, request)
    case 'slack_get_thread_replies':
      return executeToolOperationImplementation(executeSlackGetThreadRepliesOperation, request)
    case 'slack_list_channels':
      return executeToolOperationImplementation(executeSlackListConversationsOperation, request)
    case 'slack_ephemeral_message':
      return executeOperation(slackSendEphemeralContract, request, (input) =>
        executeSlackSendEphemeral(input, request.signal)
      )
    case 'slack_message':
      if (!request.context.userId) {
        return Response.json({ success: false, error: 'Authentication required' }, { status: 401 })
      }
      return executeOperation(slackSendMessageContract, request, (input) =>
        executeSlackSendMessage(input, context)
      )
    case 'slack_message_reader':
      return executeOperation(slackReadMessagesContract, request, (input) =>
        executeSlackReadMessages(input, request.signal)
      )
    case 'slack_remove_reaction':
      return executeOperation(slackRemoveReactionContract, request, (input) =>
        executeSlackRemoveReaction(input, request.signal)
      )
    case 'slack_update_message':
      return executeOperation(slackUpdateMessageContract, request, (input) =>
        executeSlackUpdateMessage(input, request.signal)
      )
    default:
      return Response.json(
        { success: false, error: `Unsupported Slack tool: ${request.toolId}` },
        { status: 500 }
      )
  }
}
