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

export const oracleFusionServiceTransitionServiceRequestStatusTool: InternalToolConfig<
  OracleFusionServiceParams,
  OracleFusionServiceResponse
> = {
  id: 'oracle_fusion_service_transition_service_request_status',
  name: 'Oracle Fusion Service Transition Service Request Status',
  description:
    'Change a Fusion Service request to a tenant-defined status, optionally recording resolution details. Oracle enforces transition permissions and rules.',
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
    statusCode: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Tenant service request status LookupCode. Oracle enforces valid transitions.',
    },
    resolveDescription: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Resolution description, up to 1000 characters.',
    },
    resolveOutcomeCode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Tenant service request resolution outcome code.',
    },
    resolutionCode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Tenant resolution code from ORA_SVC_SR_RESOLUTION_CD.',
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
      statusCode: params.statusCode,
      resolveDescription: params.resolveDescription,
      resolveOutcomeCode: params.resolveOutcomeCode,
      resolutionCode: params.resolutionCode,
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
