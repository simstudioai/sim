import {
  oracleFusionServiceAccountsOutputs,
  oracleFusionServiceAuthParams,
  oracleFusionServiceOAuth,
} from '@/tools/oracle_fusion_service/shared'
import type {
  OracleFusionServiceParams,
  OracleFusionServiceResponse,
} from '@/tools/oracle_fusion_service/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionServiceGetAccountTool: InternalToolConfig<
  OracleFusionServiceParams,
  OracleFusionServiceResponse
> = {
  id: 'oracle_fusion_service_get_account',
  name: 'Oracle Fusion Service Get Account',
  description:
    'Read one Oracle Fusion Service account. Customer master is read-only in this integration.',
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
      properties: oracleFusionServiceAccountsOutputs,
    },
  },
}
