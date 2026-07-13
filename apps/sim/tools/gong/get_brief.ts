import type { GongGetBriefParams, GongGetBriefResponse } from '@/tools/gong/types'
import { getGongErrorMessage } from '@/tools/gong/utils'
import type { ToolConfig } from '@/tools/types'

export const getBriefTool: ToolConfig<GongGetBriefParams, GongGetBriefResponse> = {
  id: 'gong_get_brief',
  name: 'Gong Get Brief',
  description:
    'Generate an AI brief (configured in Gong Agent Studio) for a CRM account, deal, contact, or lead. Consumes Gong credits.',
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
    briefName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the brief to generate, as configured in Gong Agent Studio > AI Briefer',
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
      description: 'The CRM ID of the entity to generate the brief for',
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
      const url = new URL('https://api.gong.io/v2/entities/get-brief')
      url.searchParams.set('workspaceId', params.workspaceId.trim())
      url.searchParams.set('briefName', params.briefName.trim())
      url.searchParams.set('crmEntityType', params.crmEntityType.trim().toUpperCase())
      url.searchParams.set('crmEntityId', params.crmEntityId.trim())
      url.searchParams.set('timePeriod', timePeriod)
      if (params.fromDateTime?.trim())
        url.searchParams.set('fromDateTime', params.fromDateTime.trim())
      if (params.toDateTime?.trim()) url.searchParams.set('toDateTime', params.toDateTime.trim())
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
      throw new Error(getGongErrorMessage(data, 'Failed to generate the brief'))
    }
    return {
      success: true,
      output: {
        requestId: data.requestId ?? null,
        numOfCallsSearched: data.numOfCallsSearched ?? null,
        numOfEmailsSearched: data.numOfEmailsSearched ?? null,
        briefSections: data.briefSections ?? [],
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
      description: 'Number of calls used to generate the brief',
      optional: true,
    },
    numOfEmailsSearched: {
      type: 'number',
      description: 'Number of emails used to generate the brief',
      optional: true,
    },
    briefSections: {
      type: 'array',
      description: 'Sections of the generated brief',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Section title' },
          sectionSummary: {
            type: 'array',
            description: 'The content displayed for this section',
            items: { type: 'string' },
          },
          briefSectionType: {
            type: 'string',
            description: 'The section type, which determines the source of the data',
          },
          conversationFindings: {
            type: 'object',
            description: 'Evidence from calls and emails used to generate this section',
          },
          webFindings: {
            type: 'array',
            description: 'Evidence from web search results used to generate this section',
            items: { type: 'object' },
          },
        },
      },
    },
  },
}
