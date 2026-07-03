import type { GongGetProspectFlowsParams, GongGetProspectFlowsResponse } from '@/tools/gong/types'
import { getGongErrorMessage, parseGongIdList } from '@/tools/gong/utils'
import type { ToolConfig } from '@/tools/types'

export const getProspectFlowsTool: ToolConfig<
  GongGetProspectFlowsParams,
  GongGetProspectFlowsResponse
> = {
  id: 'gong_get_prospect_flows',
  name: 'Gong Get Prospect Flows',
  description: 'Get the Gong Engage flows currently assigned to the given CRM prospects.',
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
    crmProspectsIds: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of CRM prospect IDs (contacts or leads) to look up',
    },
  },

  request: {
    url: 'https://api.gong.io/v2/flows/prospects',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Basic ${btoa(`${params.accessKey}:${params.accessKeySecret}`)}`,
    }),
    body: (params) => ({
      crmProspectsIds: parseGongIdList(params.crmProspectsIds) ?? [],
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(getGongErrorMessage(data, 'Failed to get prospect flows'))
    }
    return {
      success: true,
      output: {
        requestId: data.requestId ?? null,
        prospectsAssigned: data.prospectsAssigned ?? [],
      },
    }
  },

  outputs: {
    requestId: {
      type: 'string',
      description: 'A Gong request reference ID for troubleshooting purposes',
      optional: true,
    },
    prospectsAssigned: {
      type: 'array',
      description: 'Flows currently assigned to the requested prospects',
      items: {
        type: 'object',
        properties: {
          flowId: { type: 'string', description: 'The flow ID' },
          flowName: { type: 'string', description: 'The flow name' },
          crmProspectId: { type: 'string', description: 'The CRM prospect ID' },
          flowInstanceId: { type: 'string', description: 'The flow instance ID' },
          flowInstanceOwnerEmail: {
            type: 'string',
            description: 'Email of the flow instance owner',
          },
          flowInstanceOwnerFullName: {
            type: 'string',
            description: 'Full name of the flow instance owner',
          },
          flowInstanceCreateDate: {
            type: 'string',
            description: 'Creation time of the flow instance in ISO-8601 format',
          },
          flowInstanceStatus: { type: 'string', description: 'Status of the flow instance' },
          workspaceId: { type: 'string', description: 'Workspace ID' },
          exclusive: {
            type: 'boolean',
            description: 'Whether this prospect can be added to other flows',
          },
        },
      },
    },
  },
}
