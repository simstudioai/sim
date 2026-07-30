import type {
  GongAssignFlowProspectsParams,
  GongAssignFlowProspectsResponse,
} from '@/tools/gong/types'
import { getGongErrorMessage, parseGongIdList } from '@/tools/gong/utils'
import type { ToolConfig } from '@/tools/types'

export const assignFlowProspectsTool: ToolConfig<
  GongAssignFlowProspectsParams,
  GongAssignFlowProspectsResponse
> = {
  id: 'gong_assign_flow_prospects',
  name: 'Gong Assign Flow Prospects',
  description: 'Assign up to 200 CRM prospects (contacts or leads) to a Gong Engage flow.',
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
    flowId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The Gong Engage flow ID to assign the prospects to',
    },
    crmProspectsIds: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of CRM prospect IDs (contacts or leads) to assign',
    },
    flowInstanceOwnerEmail: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Email of the Gong user who owns the flow instance and its to-dos',
    },
  },

  request: {
    url: 'https://api.gong.io/v2/flows/prospects/assign',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Basic ${btoa(`${params.accessKey}:${params.accessKeySecret}`)}`,
    }),
    body: (params) => ({
      flowId: params.flowId.trim(),
      crmProspectsIds: parseGongIdList(params.crmProspectsIds) ?? [],
      flowInstanceOwnerEmail: params.flowInstanceOwnerEmail.trim(),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(getGongErrorMessage(data, 'Failed to assign prospects to flow'))
    }
    return {
      success: true,
      output: {
        requestId: data.requestId ?? null,
        prospectsAssigned: data.prospectsAssigned ?? [],
        prospectsNotAssigned: data.prospectsNotAssigned ?? [],
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
      description: 'Prospects successfully assigned to the flow',
      items: {
        type: 'object',
        properties: {
          flowId: { type: 'string', description: 'The flow ID' },
          flowName: { type: 'string', description: 'The flow name' },
          crmProspectId: { type: 'string', description: 'The CRM prospect ID' },
          flowInstanceId: { type: 'string', description: 'The created flow instance ID' },
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
    prospectsNotAssigned: {
      type: 'array',
      description: 'Prospects that failed to be assigned to the flow',
      items: {
        type: 'object',
        properties: {
          flowId: { type: 'string', description: 'The flow ID' },
          crmProspectId: { type: 'string', description: 'The CRM prospect ID' },
          errorCode: {
            type: 'string',
            description: 'Failure reason: InvalidArgument, InvalidState, or UnexpectedError',
          },
          errorMessage: { type: 'string', description: 'Human-readable failure message' },
        },
      },
    },
  },
}
