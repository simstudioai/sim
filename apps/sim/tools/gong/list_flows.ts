import type { GongListFlowsParams, GongListFlowsResponse } from '@/tools/gong/types'
import type { ToolConfig } from '@/tools/types'

export const listFlowsTool: ToolConfig<GongListFlowsParams, GongListFlowsResponse> = {
  id: 'gong_list_flows',
  name: 'Gong List Flows',
  description: 'List Gong Engage flows (sales engagement sequences).',
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
    flowOwnerEmail: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        "Email of a Gong user. The API will return 'PERSONAL' flows belonging to this user in addition to 'COMPANY' flows.",
    },
    workspaceId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional workspace ID to filter flows to a specific workspace',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Pagination cursor from a previous API call to retrieve the next page of records',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.gong.io/v2/flows')
      url.searchParams.set('flowOwnerEmail', params.flowOwnerEmail)
      if (params.workspaceId) url.searchParams.set('workspaceId', params.workspaceId)
      if (params.cursor) url.searchParams.set('cursor', params.cursor)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Basic ${btoa(`${params.accessKey}:${params.accessKeySecret}`)}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.errors?.[0]?.message || data.message || 'Failed to list flows')
    }
    const flows = (data.flows ?? []).map((f: Record<string, unknown>) => ({
      id: f.id ?? '',
      name: f.name ?? null,
      folderId: f.folderId ?? null,
      folderName: f.folderName ?? null,
      visibility: f.visibility ?? null,
      creationDate: f.creationDate ?? null,
      exclusive: f.exclusive ?? null,
    }))
    return {
      success: true,
      output: {
        requestId: data.requestId ?? null,
        flows,
        totalRecords: data.records?.totalRecords ?? null,
        currentPageSize: data.records?.currentPageSize ?? null,
        currentPageNumber: data.records?.currentPageNumber ?? null,
        cursor: data.records?.cursor ?? null,
      },
    }
  },

  outputs: {
    requestId: {
      type: 'string',
      description: 'A Gong request reference ID for troubleshooting purposes',
    },
    flows: {
      type: 'array',
      description: 'List of Gong Engage flows',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'The ID of the flow' },
          name: { type: 'string', description: 'The name of the flow' },
          folderId: { type: 'string', description: 'The ID of the folder this flow is under' },
          folderName: { type: 'string', description: 'The name of the folder this flow is under' },
          visibility: {
            type: 'string',
            description: 'The flow visibility type (COMPANY, PERSONAL, or SHARED)',
          },
          creationDate: {
            type: 'string',
            description: 'Creation time of the flow in ISO-8601 format',
          },
          exclusive: {
            type: 'boolean',
            description: 'Indicates whether a prospect in this flow can be added to other flows',
          },
        },
      },
    },
    totalRecords: {
      type: 'number',
      description: 'Total number of flow records available',
    },
    currentPageSize: {
      type: 'number',
      description: 'Number of records returned in the current page',
    },
    currentPageNumber: {
      type: 'number',
      description: 'Current page number',
    },
    cursor: {
      type: 'string',
      description: 'Pagination cursor for retrieving the next page of records',
    },
  },
}
