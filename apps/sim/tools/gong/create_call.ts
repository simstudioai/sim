import type { GongCreateCallParams, GongCreateCallResponse } from '@/tools/gong/types'
import { getGongErrorMessage, parseGongJsonArray } from '@/tools/gong/utils'
import type { ToolConfig } from '@/tools/types'

export const createCallTool: ToolConfig<GongCreateCallParams, GongCreateCallResponse> = {
  id: 'gong_create_call',
  name: 'Gong Create Call',
  description: 'Upload call metadata to Gong and let Gong pull the media from a URL.',
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
    clientUniqueId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Unique call ID from the source telephony or recording system',
    },
    actualStart: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Actual call start time in ISO-8601 format',
    },
    primaryUser: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: "Gong user ID for the call's host or owner",
    },
    parties: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'Array of call parties, with at least the primary user included',
    },
    direction: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Call direction: Inbound, Outbound, Conference, or Unknown',
    },
    downloadMediaUrl: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'URL where Gong can download the call media file',
    },
    title: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Human-readable call title',
    },
    workspaceId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional Gong workspace ID',
    },
    disposition: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional call disposition',
    },
    purpose: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional call purpose',
    },
    context: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional CRM context array for the call',
    },
    callProviderCode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional conferencing or telephony provider code',
    },
  },

  request: {
    url: 'https://api.gong.io/v2/calls',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Basic ${btoa(`${params.accessKey}:${params.accessKeySecret}`)}`,
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        clientUniqueId: params.clientUniqueId.trim(),
        actualStart: params.actualStart.trim(),
        primaryUser: params.primaryUser.trim(),
        parties: parseGongJsonArray(params.parties, 'parties'),
        direction: params.direction,
        downloadMediaUrl: params.downloadMediaUrl.trim(),
      }

      if (params.title?.trim()) body.title = params.title.trim()
      if (params.workspaceId?.trim()) body.workspaceId = params.workspaceId.trim()
      if (params.disposition?.trim()) body.disposition = params.disposition.trim()
      if (params.purpose?.trim()) body.purpose = params.purpose.trim()
      if (params.context) body.context = parseGongJsonArray(params.context, 'context')
      if (params.callProviderCode?.trim()) body.callProviderCode = params.callProviderCode.trim()

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(getGongErrorMessage(data, 'Failed to create Gong call'))
    }

    return {
      success: true,
      output: {
        callId: data.callId ?? '',
        requestId: data.requestId ?? '',
        url: data.url ?? null,
      },
    }
  },

  outputs: {
    callId: {
      type: 'string',
      description: "Gong's unique numeric identifier for the created call",
    },
    requestId: {
      type: 'string',
      description: 'Gong request reference ID for troubleshooting',
    },
    url: {
      type: 'string',
      description: 'URL to the created call in the Gong web app',
      optional: true,
    },
  },
}
