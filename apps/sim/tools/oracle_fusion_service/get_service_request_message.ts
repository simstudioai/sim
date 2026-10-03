import {
  oracleFusionServiceAuthParams,
  oracleFusionServiceMessagesOutputs,
  oracleFusionServiceOAuth,
} from '@/tools/oracle_fusion_service/shared'
import type {
  OracleFusionServiceParams,
  OracleFusionServiceResponse,
} from '@/tools/oracle_fusion_service/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionServiceGetServiceRequestMessageTool: InternalToolConfig<
  OracleFusionServiceParams,
  OracleFusionServiceResponse
> = {
  id: 'oracle_fusion_service_get_service_request_message',
  name: 'Oracle Fusion Service Get Service Request Message',
  description:
    'Read one Oracle Fusion Service service request message. Includes message and internal-note content exactly as returned by Oracle, without encoding conversion.',
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
    messageId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Service request MessageId as an exact decimal string.',
    },
  },
  operation: {
    input: (params) => ({
      accessToken: params.accessToken,
      instanceUrl: params.instanceUrl,
      srNumber: params.srNumber,
      messageId: params.messageId,
    }),
  },
  outputs: {
    item: {
      type: 'object',
      description: 'Documented Oracle resource fields.',
      properties: oracleFusionServiceMessagesOutputs,
    },
  },
}
