import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { DEFAULT_EXECUTION_TIMEOUT_MS } from '@/lib/core/execution-limits'
import {
  type DatabricksGenieAskParams,
  type DatabricksGenieAskResponse,
  type DatabricksGenieGetMessageResponse,
  type DatabricksGenieQueryResultResponse,
  GENIE_MESSAGE_OUTPUT_PROPERTIES,
  STATEMENT_RESULT_OUTPUT_PROPERTIES,
} from '@/tools/databricks/types'
import {
  databricksErrorMessage,
  databricksUrl,
  GENIE_SPACE_PARAMS,
  GENIE_TERMINAL_STATUSES,
  genieConversationPath,
  genieSpacePath,
  mapGenieMessage,
} from '@/tools/databricks/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('DatabricksGenieAskTool')

/** Databricks recommends polling every 1–5 seconds, backing off between polls. */
const MAX_POLL_INTERVAL_MS = 5000
const MAX_POLL_TIME_MS = DEFAULT_EXECUTION_TIMEOUT_MS

const EMPTY_QUERY_RESULT = {
  columns: null,
  data: null,
  totalRows: null,
  truncated: null,
} as const

export const genieAskTool: ToolConfig<DatabricksGenieAskParams, DatabricksGenieAskResponse> = {
  id: 'databricks_genie_ask',
  name: 'Databricks Genie Ask',
  description:
    'Ask a Databricks Genie space a question in natural language and wait for the answer. Starts a new conversation, or continues an existing one when a conversation ID is given. Returns the text answer, the SQL Genie generated, and the query result rows.',
  version: '1.0.0',

  params: {
    ...GENIE_SPACE_PARAMS,
    content: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The question to ask Genie',
    },
    conversationId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Continue this conversation so Genie uses its earlier messages as context. Omit to start a new conversation.',
    },
    enableVisualization: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Ask Genie to also generate a chart when one fits the answer',
    },
  },

  request: {
    modelInput: {
      mode: 'project',
      select: (params) => ({ content: params.content }),
    },
    url: (params) => {
      const conversationId = params.conversationId?.trim()
      return databricksUrl(
        params.host,
        conversationId
          ? `${genieConversationPath(params.spaceId, conversationId)}/messages`
          : `${genieSpacePath(params.spaceId)}/start-conversation`
      )
    },
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => ({
      content: params.content,
      ...(params.enableVisualization ? { enable_visualization: true } : {}),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(databricksErrorMessage(data, 'Failed to send message to Genie'))
    }

    /** Start Conversation nests the message; Create Message returns it at the top level. */
    const message = mapGenieMessage(data.message ?? data)

    return {
      success: true,
      output: {
        ...message,
        conversationId: data.conversation_id ?? message.conversationId,
        messageId: data.message_id ?? message.messageId,
        ...EMPTY_QUERY_RESULT,
      },
    }
  },

  postProcess: async (result, params, executeTool) => {
    const { conversationId, messageId } = result.output
    if (!conversationId || !messageId) {
      return {
        ...result,
        success: false,
        error: 'Genie did not return a conversation or message ID',
      }
    }

    const messageParams = {
      host: params.host,
      apiKey: params.apiKey,
      spaceId: params.spaceId,
      conversationId,
      messageId,
    }

    let message = result.output

    /**
     * A nested call can throw instead of returning a failed result, and the executor falls back
     * to the pending first response when post-processing throws. Convert every failure here so
     * the ask fails with its conversation and message IDs intact.
     */
    try {
      const startedAt = Date.now()
      let attempt = 0

      while (!GENIE_TERMINAL_STATUSES.has(message.status)) {
        if (Date.now() - startedAt >= MAX_POLL_TIME_MS) {
          logger.warn(`Genie message ${messageId} did not complete within ${MAX_POLL_TIME_MS} ms`)
          return {
            ...result,
            output: message,
            success: false,
            error: `Genie did not answer within ${MAX_POLL_TIME_MS / 1000}s (last status: ${message.status}). Use Get Genie Message with this conversation and message ID to check on it.`,
          }
        }

        attempt += 1
        const intervalMs = Math.min(1000 * attempt, MAX_POLL_INTERVAL_MS)
        await sleep(intervalMs)

        const polled = (await executeTool(
          'databricks_genie_get_message',
          messageParams
        )) as DatabricksGenieGetMessageResponse
        if (!polled.success) {
          return {
            ...result,
            output: message,
            success: false,
            error: polled.error ?? 'Failed to poll Genie message',
          }
        }
        message = { ...message, ...polled.output }
      }

      if (message.status === 'FAILED' || message.status === 'CANCELLED') {
        return {
          ...result,
          output: message,
          success: false,
          error: message.error ?? `Genie message ${message.status.toLowerCase()}`,
        }
      }

      if (message.status !== 'COMPLETED' || !message.queryAttachmentId) {
        return { ...result, output: message }
      }

      const queryResult = (await executeTool('databricks_genie_get_query_result', {
        ...messageParams,
        attachmentId: message.queryAttachmentId,
      })) as DatabricksGenieQueryResultResponse
      if (!queryResult.success) {
        return {
          ...result,
          output: message,
          success: false,
          error: queryResult.error ?? 'Failed to get Genie query result',
        }
      }

      return {
        ...result,
        output: {
          ...message,
          columns: queryResult.output.columns,
          data: queryResult.output.data,
          totalRows: queryResult.output.totalRows,
          truncated: queryResult.output.truncated,
        },
      }
    } catch (error) {
      logger.error(`Error waiting for Genie message ${messageId}`, {
        message: getErrorMessage(error, 'Unknown error'),
      })
      return {
        ...result,
        output: message,
        success: false,
        error: `Error waiting for Genie to answer: ${getErrorMessage(error, 'Unknown error')}`,
      }
    }
  },

  outputs: {
    ...GENIE_MESSAGE_OUTPUT_PROPERTIES,
    ...STATEMENT_RESULT_OUTPUT_PROPERTIES,
  },
}
