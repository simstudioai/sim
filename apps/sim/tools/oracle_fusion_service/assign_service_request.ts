import {
  oracleFusionServiceAuthParams,
  oracleFusionServiceOAuth,
  oracleFusionServiceRequestOutputs,
} from '@/tools/oracle_fusion_service/shared'
import type {
  OracleFusionServiceParams,
  OracleFusionServiceResponse,
} from '@/tools/oracle_fusion_service/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionServiceAssignServiceRequestTool: InternalToolConfig<
  OracleFusionServiceParams,
  OracleFusionServiceResponse
> = {
  id: 'oracle_fusion_service_assign_service_request',
  name: 'Oracle Fusion Service Assign Service Request',
  description:
    'Assign a Fusion Service request to a queue, an agent resource, or both. Resource PartyId maps to AssigneeResourceId.',
  version: '1.0.0',
  oauth: oracleFusionServiceOAuth,
  params: {
    ...oracleFusionServiceAuthParams,
    srNumber: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Service request number (SrNumber), not the numeric SrId.',
    },
    queueId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'QueueId as an exact decimal string.',
    },
    resourcePartyId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Agent resource PartyId, not ResourceProfileId. Sent as AssigneeResourceId or child ObjectId.',
    },
    ifMatch: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional Oracle ETag for conditional PATCH or DELETE (If-Match).',
    },
  },
  operation: {
    input: (params) => ({
      accessToken: params.accessToken,
      instanceUrl: params.instanceUrl,
      srNumber: params.srNumber,
      queueId: params.queueId,
      resourcePartyId: params.resourcePartyId,
      ifMatch: params.ifMatch,
    }),
  },
  outputs: {
    item: {
      type: 'object',
      description: 'Documented Oracle resource fields.',
      properties: oracleFusionServiceRequestOutputs,
    },
  },
}
