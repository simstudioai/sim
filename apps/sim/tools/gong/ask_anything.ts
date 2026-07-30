import type { GongAskAnythingParams, GongAskAnythingResponse } from '@/tools/gong/types'
import { getGongErrorMessage } from '@/tools/gong/utils'
import type { ToolConfig } from '@/tools/types'

export const askAnythingTool: ToolConfig<GongAskAnythingParams, GongAskAnythingResponse> = {
  id: 'gong_ask_anything',
  name: 'Gong Ask Anything',
  description:
    'Ask a natural-language question about a CRM account, deal, contact, or lead. Gong answers from up to 60 calls and 500 emails associated with the entity. Consumes Gong credits.',
  version: '1.0.0',

  params: {
    accessKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Gong API Access Key',
    },
    accessKeySecret: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Gong API Access Key Secret',
    },
    workspaceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Gong workspace ID the entity belongs to',
    },
    crmEntityType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Type of the CRM entity: ACCOUNT, CONTACT, DEAL, or LEAD',
    },
    crmEntityId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The CRM ID of the entity the question is asked about',
    },
    question: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The natural-language question to ask about the entity',
    },
    timePeriod: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Time period of conversations to consider: LAST_7DAYS, LAST_30DAYS, LAST_90DAYS, LAST_90_DAYS_SINCE_LAST_ACTIVITY, LAST_YEAR_SINCE_LAST_ACTIVITY, LAST_YEAR, THIS_WEEK, THIS_MONTH, THIS_YEAR, THIS_QUARTER, CUSTOM_RANGE, or ALL_CONVERSATIONS',
    },
    fromDateTime: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Start date/time (UTC, ISO-8601) for calls and emails to include. Required when timePeriod is CUSTOM_RANGE.',
    },
    toDateTime: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'End date/time (UTC, ISO-8601) for calls and emails to include. Required when timePeriod is CUSTOM_RANGE.',
    },
  },

  request: {
    url: (params) => {
      const timePeriod = params.timePeriod.trim().toUpperCase()
      if (
        timePeriod === 'CUSTOM_RANGE' &&
        (!params.fromDateTime?.trim() || !params.toDateTime?.trim())
      ) {
        throw new Error('fromDateTime and toDateTime are required when timePeriod is CUSTOM_RANGE')
      }
      const url = new URL('https://api.gong.io/v2/entities/ask-entity')
      url.searchParams.set('workspaceId', params.workspaceId.trim())
      url.searchParams.set('crmEntityType', params.crmEntityType.trim().toUpperCase())
      url.searchParams.set('crmEntityId', params.crmEntityId.trim())
      url.searchParams.set('timePeriod', timePeriod)
      url.searchParams.set('question', params.question.trim())
      if (timePeriod === 'CUSTOM_RANGE') {
        url.searchParams.set('fromDateTime', params.fromDateTime?.trim() ?? '')
        url.searchParams.set('toDateTime', params.toDateTime?.trim() ?? '')
      }
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Basic ${btoa(`${params.accessKey}:${params.accessKeySecret}`)}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(getGongErrorMessage(data, 'Failed to ask about the entity'))
    }
    const answer = (data.answer ?? []).map((section: Record<string, unknown>) => ({
      answerItems: section.answerItems ?? [],
      callFindings: section.callFindings ?? [],
      emailFindings: section.emailFindings ?? [],
    }))
    return {
      success: true,
      output: {
        requestId: data.requestId ?? null,
        numOfCallsSearched: data.numOfCallsSearched ?? null,
        numOfEmailsSearched: data.numOfEmailsSearched ?? null,
        answer,
      },
    }
  },

  outputs: {
    requestId: {
      type: 'string',
      description: 'A Gong request reference ID for troubleshooting purposes',
      optional: true,
    },
    numOfCallsSearched: {
      type: 'number',
      description: 'Number of calls used to generate the answer',
      optional: true,
    },
    numOfEmailsSearched: {
      type: 'number',
      description: 'Number of emails used to generate the answer',
      optional: true,
    },
    answer: {
      type: 'array',
      description: 'Sections of the generated answer with supporting evidence',
      items: {
        type: 'object',
        properties: {
          answerItems: {
            type: 'array',
            description: 'Text items that make up this part of the answer',
            items: { type: 'string' },
          },
          callFindings: {
            type: 'array',
            description: 'Evidence from calls used to generate this answer item',
            items: { type: 'object' },
          },
          emailFindings: {
            type: 'array',
            description: 'Evidence from emails used to generate this answer item',
            items: { type: 'object' },
          },
        },
      },
    },
  },
}
