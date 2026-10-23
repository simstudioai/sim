import {
  type DatabricksGenieAgentAskParams,
  type DatabricksGenieAgentAskResponse,
  GENIE_AGENT_ITEM_OUTPUT_PROPERTIES,
} from '@/tools/databricks/types'
import {
  databricksUrl,
  GENIE_SPACE_PARAMS,
  genieAgentErrorMessage,
  genieAgentPath,
  mapGenieAgentItem,
  parseGenieAgentQuery,
  parseGenieAgentStream,
} from '@/tools/databricks/utils'
import type { ToolConfig } from '@/tools/types'

export const genieAgentAskTool: ToolConfig<
  DatabricksGenieAgentAskParams,
  DatabricksGenieAgentAskResponse
> = {
  id: 'databricks_genie_agent_ask',
  name: 'Databricks Genie Agent Ask',
  description:
    'Ask a Genie agent a question in agent mode, where Genie plans multi-step research, runs several SQL queries, and writes a report with citations. Waits for the final report. Starts a new agent-mode conversation, or continues one when a conversation ID is given. Agent mode is in preview and must be enabled on the workspace.',
  version: '1.0.0',

  params: {
    ...GENIE_SPACE_PARAMS,
    spaceId: {
      ...GENIE_SPACE_PARAMS.spaceId,
      description: 'The ID of the Genie space (the Genie agent ID)',
    },
    content: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The question to ask the Genie agent',
    },
    conversationId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Continue this agent-mode conversation. Omit to start a new conversation.',
    },
    enableVisualization: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Ask the agent to also generate charts where they fit',
    },
  },

  request: {
    modelInput: {
      mode: 'project',
      select: (params) => ({ content: params.content }),
    },
    url: (params) => databricksUrl(params.host, `${genieAgentPath(params.spaceId)}/responses`),
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => {
      const conversationId = params.conversationId?.trim()
      return {
        input: [
          {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: params.content }],
          },
        ],
        ...(conversationId ? { conversation_id: conversationId } : {}),
        ...(params.enableVisualization ? { enable_viz: true } : {}),
      }
    },
  },

  transformResponse: async (response: Response) => {
    const { created, final } = parseGenieAgentStream(await response.text())

    if (!final) {
      throw new Error(
        created?.id
          ? `Genie agent stream ended before response ${created.id} completed`
          : 'Genie agent stream ended without a response'
      )
    }
    const responseId = final.id ?? created?.id ?? ''
    const conversationId = final.conversation_id ?? created?.conversation_id ?? ''
    const context = `Genie agent response ${responseId} in conversation ${conversationId}`

    if (final.status === 'failed') {
      throw new Error(`${context} failed: ${genieAgentErrorMessage(final.error)}`)
    }

    const items = (final.output ?? []).map(mapGenieAgentItem)
    const joinMessages = (role: string) =>
      items
        .filter((item) => item.type === 'message' && item.role === role && item.text)
        .map((item) => item.text)
        .join('\n\n') || null
    const report = joinMessages('assistant')
    /** A message item can be a system error rather than an assistant report. */
    const error = joinMessages('system')

    if (!report && error) {
      throw new Error(`${context} ended with an error: ${error}`)
    }

    return {
      success: true,
      output: {
        responseId,
        conversationId,
        status: final.status ?? 'completed',
        report,
        queries: items
          .filter((item) => item.type === 'function_call' && item.name === 'execute_sql')
          .map(parseGenieAgentQuery),
        items,
        createdAt: final.created_at ?? null,
        error,
      },
    }
  },

  outputs: {
    responseId: { type: 'string', description: 'Agent response ID' },
    conversationId: {
      type: 'string',
      description: 'Agent-mode conversation ID; pass it back to ask a follow-up',
    },
    status: { type: 'string', description: 'Response status (completed)' },
    report: {
      type: 'string',
      description: "The agent's final report, with citation links",
      nullable: true,
    },
    queries: {
      type: 'array',
      description: 'SQL queries the agent ran',
      items: {
        type: 'object',
        properties: {
          callId: { type: 'string', description: 'Function call ID' },
          title: { type: 'string', description: 'Query title', nullable: true },
          sql: { type: 'string', description: 'SQL the agent ran', nullable: true },
        },
      },
    },
    items: {
      type: 'array',
      description: 'Every output item: reasoning, SQL calls, query results, and messages',
      items: {
        type: 'object',
        properties: GENIE_AGENT_ITEM_OUTPUT_PROPERTIES,
      },
    },
    createdAt: {
      type: 'number',
      description: 'When the response was created (Unix epoch seconds)',
      nullable: true,
    },
    error: {
      type: 'string',
      description: 'System error message the agent reported alongside its report',
      nullable: true,
    },
  },
}
