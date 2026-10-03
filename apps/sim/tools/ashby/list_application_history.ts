import { ashbyAuthHeaders, ashbyErrorMessage, ashbyLimit } from '@/tools/ashby/utils'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface Params {
  apiKey: string
  applicationId: string
  cursor?: string
  perPage?: number
}
interface Response extends ToolResponse {
  output: { history: unknown[]; moreDataAvailable: boolean; nextCursor: string | null }
}

export const listApplicationHistoryTool: ToolConfig<Params, Response> = {
  id: 'ashby_list_application_history',
  name: 'Ashby List Application History',
  description: 'Lists the full stage history and allowed actions for an application.',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Ashby API Key',
    },
    applicationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Application UUID',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor',
    },
    perPage: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Results per page (1-100)',
    },
  },
  request: {
    url: 'https://api.ashbyhq.com/application.listHistory',
    method: 'POST',
    headers: (p) => ashbyAuthHeaders(p.apiKey),
    body: (p) => ({
      applicationId: p.applicationId.trim(),
      ...(p.cursor ? { cursor: p.cursor } : {}),
      ...(ashbyLimit(p.perPage) ? { limit: ashbyLimit(p.perPage) } : {}),
    }),
  },
  transformResponse: async (response) => {
    const data = await response.json()
    if (!data.success)
      throw new Error(ashbyErrorMessage(data, 'Failed to list application history'))
    return {
      success: true,
      output: {
        history: data.results ?? [],
        moreDataAvailable: data.moreDataAvailable ?? false,
        nextCursor: data.nextCursor ?? null,
      },
    }
  },
  outputs: {
    history: {
      type: 'array',
      description: 'Application stage history',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'History entry UUID' },
          stageId: { type: 'string', description: 'Stage UUID' },
          title: { type: 'string', description: 'Stage title' },
          enteredStageAt: { type: 'string', description: 'Stage entry timestamp' },
          leftStageAt: { type: 'string', description: 'Stage exit timestamp', optional: true },
          stageNumber: { type: 'number', description: 'Stage sequence number' },
          allowedActions: {
            type: 'array',
            description: 'Actions permitted at this history point',
            items: { type: 'string', description: 'Allowed action' },
          },
          actorId: { type: 'string', description: 'Acting user UUID', optional: true },
        },
      },
    },
    moreDataAvailable: { type: 'boolean', description: 'Whether more pages exist' },
    nextCursor: { type: 'string', description: 'Next page cursor', optional: true },
  },
}
