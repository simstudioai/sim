import {
  oracleFusionServiceAuthParams,
  oracleFusionServiceOAuth,
  oracleFusionServiceRequestResourcesOutputs,
} from '@/tools/oracle_fusion_service/shared'
import type {
  OracleFusionServiceParams,
  OracleFusionServiceResponse,
} from '@/tools/oracle_fusion_service/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionServiceAddServiceRequestResourceTool: InternalToolConfig<
  OracleFusionServiceParams,
  OracleFusionServiceResponse
> = {
  id: 'oracle_fusion_service_add_service_request_resource',
  name: 'Oracle Fusion Service Add Service Request Resource',
  description:
    'Add an existing resource to a service request team using its PartyId. This does not create an agent.',
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
    resourcePartyId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Agent resource PartyId, not ResourceProfileId. Sent as AssigneeResourceId or child ObjectId.',
    },
    owner: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether this team member is the service request owner.',
    },
  },
  operation: {
    input: (params) => ({
      accessToken: params.accessToken,
      instanceUrl: params.instanceUrl,
      srNumber: params.srNumber,
      resourcePartyId: params.resourcePartyId,
      owner: params.owner,
    }),
  },
  outputs: {
    item: {
      type: 'object',
      description: 'Documented Oracle resource fields.',
      properties: oracleFusionServiceRequestResourcesOutputs,
    },
  },
}
