import {
  oracleFusionServiceAuthParams,
  oracleFusionServiceOAuth,
} from '@/tools/oracle_fusion_service/shared'
import type {
  OracleFusionServiceParams,
  OracleFusionServiceResponse,
} from '@/tools/oracle_fusion_service/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionServiceRemoveServiceRequestResourceTool: InternalToolConfig<
  OracleFusionServiceParams,
  OracleFusionServiceResponse
> = {
  id: 'oracle_fusion_service_remove_service_request_resource',
  name: 'Oracle Fusion Service Remove Service Request Resource',
  description:
    'Remove a resource membership from a service request team by MemberId. This does not delete the agent.',
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
    memberId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Service request child MemberId, not the contact or resource PartyId.',
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
      memberId: params.memberId,
      ifMatch: params.ifMatch,
    }),
  },
  outputs: {
    deleted: { type: 'boolean', description: 'Whether the membership was removed.' },
  },
}
