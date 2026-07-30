import type {
  GongUnassignFlowProspectsParams,
  GongUnassignFlowProspectsResponse,
} from '@/tools/gong/types'
import { getGongErrorMessage } from '@/tools/gong/utils'
import type { ToolConfig } from '@/tools/types'

export const unassignFlowProspectsTool: ToolConfig<
  GongUnassignFlowProspectsParams,
  GongUnassignFlowProspectsResponse
> = {
  id: 'gong_unassign_flow_prospects',
  name: 'Gong Unassign Flow Prospects',
  description:
    'Remove a prospect from Gong Engage flows. Omit the flow ID to remove the prospect from all flows they are assigned to.',
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
    crmProspectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The CRM ID of the prospect to unassign',
    },
    flowId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The ID of the flow to unassign the prospect from. If omitted, the prospect is removed from all flows they are assigned to.',
    },
    unassignedByUserEmail: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Email address of the Gong user requesting to remove the prospect from the flow',
    },
  },

  request: {
    url: 'https://api.gong.io/v2/flows/prospects/unassign-flows-by-crm-id',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Basic ${btoa(`${params.accessKey}:${params.accessKeySecret}`)}`,
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        crmProspectId: params.crmProspectId.trim(),
      }
      if (params.flowId?.trim()) body.flowId = params.flowId.trim()
      if (params.unassignedByUserEmail?.trim()) {
        body.unassignedByUserEmail = params.unassignedByUserEmail.trim()
      }
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(getGongErrorMessage(data, 'Failed to unassign prospect from flows'))
    }
    return {
      success: true,
      output: {
        requestId: data.requestId ?? null,
        unassignedFlowInstanceIds: data.unassignedFlowInstanceIds ?? [],
      },
    }
  },

  outputs: {
    requestId: {
      type: 'string',
      description: 'A Gong request reference ID for troubleshooting purposes',
      optional: true,
    },
    unassignedFlowInstanceIds: {
      type: 'array',
      description: 'IDs of the flow instances the prospect was successfully removed from',
      items: { type: 'string' },
    },
  },
}
