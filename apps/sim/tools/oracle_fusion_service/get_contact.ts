import {
  oracleFusionServiceAuthParams,
  oracleFusionServiceContactsOutputs,
  oracleFusionServiceOAuth,
} from '@/tools/oracle_fusion_service/shared'
import type {
  OracleFusionServiceParams,
  OracleFusionServiceResponse,
} from '@/tools/oracle_fusion_service/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionServiceGetContactTool: InternalToolConfig<
  OracleFusionServiceParams,
  OracleFusionServiceResponse
> = {
  id: 'oracle_fusion_service_get_contact',
  name: 'Oracle Fusion Service Get Contact',
  description:
    'Read one Oracle Fusion Service contact. Customer master is read-only in this integration.',
  version: '1.0.0',
  oauth: oracleFusionServiceOAuth,
  params: {
    ...oracleFusionServiceAuthParams,
    partyNumber: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Directory PartyNumber, not the numeric PartyId returned by assignment selectors.',
    },
  },
  operation: {
    input: (params) => ({
      accessToken: params.accessToken,
      instanceUrl: params.instanceUrl,
      partyNumber: params.partyNumber,
    }),
  },
  outputs: {
    item: {
      type: 'object',
      description: 'Documented Oracle resource fields.',
      properties: oracleFusionServiceContactsOutputs,
    },
  },
}
