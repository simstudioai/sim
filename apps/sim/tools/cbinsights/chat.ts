import type { CbInsightsAuthParams, CbInsightsChatResponse } from '@/tools/cbinsights/types'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export interface CbInsightsChatParams extends CbInsightsAuthParams {
  message: string
  chatId?: string
}

export const cbinsightsChatTool: InternalToolConfig<CbInsightsChatParams, CbInsightsChatResponse> =
  {
    id: 'cbinsights_chat',
    name: 'CB Insights Chat',
    description:
      'Ask ChatCBI a question in natural language and get an answer grounded in CB Insights data, with its sources and suggested follow-ups. Uses generative AI and can be wrong — verify anything that matters.',
    version: '1.0.0',

    params: {
      clientId: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'CB Insights API client ID, exchanged for a bearer token before each call',
      },
      clientSecret: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'CB Insights API client secret, exchanged for a bearer token before each call',
      },
      message: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description:
          'The question to ask, e.g. "Which emerging technology markets are seeing the highest equity funding growth right now?"',
      },
      chatId: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Conversation ID returned by a previous call. Pass it to continue that conversation rather than starting a new one.',
      },
    },

    operation: {
      input: createInternalToolOperationInput,
      modelInput: {
        mode: 'project',
        select: (params) => ({ message: params.message }),
      },
    },

    outputs: {
      chatId: {
        type: 'string',
        nullable: true,
        description: 'Conversation ID. Pass it back as chatId to continue this conversation.',
      },
      title: {
        type: 'string',
        nullable: true,
        description: 'Title CB Insights gave the conversation',
      },
      message: {
        type: 'string',
        nullable: true,
        description: "ChatCBI's answer, as Markdown",
      },
      sources: {
        type: 'json',
        description:
          'Sources behind the answer as [{sourceIndex, result: {title, url, date, thumbnailUrl}}]',
      },
      relatedContent: {
        type: 'json',
        description: 'Related references as [{title, url, date, thumbnailUrl}]',
      },
      suggestions: {
        type: 'json',
        description: 'Suggested follow-up questions',
      },
    },
  }
