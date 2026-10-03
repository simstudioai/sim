import {
  oracleFusionServiceAuthParams,
  oracleFusionServiceBusinessUnitsOutputs,
  oracleFusionServiceOAuth,
} from '@/tools/oracle_fusion_service/shared'
import type {
  OracleFusionServiceParams,
  OracleFusionServiceResponse,
} from '@/tools/oracle_fusion_service/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionServiceGetServiceBusinessUnitTool: InternalToolConfig<
  OracleFusionServiceParams,
  OracleFusionServiceResponse
> = {
  id: 'oracle_fusion_service_get_service_business_unit',
  name: 'Oracle Fusion Service Get Service Business Unit',
  description: 'Read one Oracle Fusion Service service business unit.',
  version: '1.0.0',
  oauth: oracleFusionServiceOAuth,
  params: {
    ...oracleFusionServiceAuthParams,
    businessUnitId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Service business unit BUOrgId as an exact decimal string.',
    },
  },
  operation: {
    input: (params) => ({
      accessToken: params.accessToken,
      instanceUrl: params.instanceUrl,
      businessUnitId: params.businessUnitId,
    }),
  },
  outputs: {
    item: {
      type: 'object',
      description: 'Documented Oracle resource fields.',
      properties: oracleFusionServiceBusinessUnitsOutputs,
    },
  },
}
