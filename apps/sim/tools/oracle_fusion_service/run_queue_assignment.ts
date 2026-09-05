import {
  oracleFusionServiceAuthParams,
  oracleFusionServiceOAuth,
} from '@/tools/oracle_fusion_service/shared'
import type {
  OracleFusionServiceParams,
  OracleFusionServiceResponse,
} from '@/tools/oracle_fusion_service/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionServiceRunQueueAssignmentTool: InternalToolConfig<
  OracleFusionServiceParams,
  OracleFusionServiceResponse
> = {
  id: 'oracle_fusion_service_run_queue_assignment',
  name: 'Oracle Fusion Service Run Queue Assignment',
  description:
    "Run Oracle automatic queue assignment for one service request. Returns Oracle's documented string result without interpreting it.",
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
    overrideQueue: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Allow automatic assignment to override the existing queue.',
    },
  },
  operation: {
    input: (params) => ({
      accessToken: params.accessToken,
      instanceUrl: params.instanceUrl,
      srNumber: params.srNumber,
      overrideQueue: params.overrideQueue,
    }),
  },
  outputs: {
    result: { type: 'string', description: 'Oracle queue assignment result.' },
  },
}
