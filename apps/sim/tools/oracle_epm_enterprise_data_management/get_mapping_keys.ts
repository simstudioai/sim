import type {
  OracleEpmEdmGetMappingKeysParams,
  OracleEpmEdmGetMappingKeysResponse,
} from '@/tools/oracle_epm_enterprise_data_management/types'
import {
  edmAuthParams,
  edmOperationInput,
  edmOutputs,
  edmParam,
} from '@/tools/oracle_epm_enterprise_data_management/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmEdmGetMappingKeysTool: InternalToolConfig<
  OracleEpmEdmGetMappingKeysParams,
  OracleEpmEdmGetMappingKeysResponse
> = {
  id: 'oracle_epm_edm_get_mapping_keys',
  name: 'Oracle EDM Get Mapping Keys',
  description:
    'Get mapping locations and source/target node-type references for a dimension binding.',
  version: '1.0.0',
  oauth: {
    required: true,
    provider: 'oracle-epm-enterprise-data-management',
    credentialKind: 'service-account',
    authoritativeParams: ['instanceUrl'],
  },
  params: {
    ...edmAuthParams,
    dimensionId: edmParam('string', true, 'Dimension UUID'),
    bindingId: edmParam('string', true, 'Dimension binding UUID'),
  },
  operation: { input: (params) => edmOperationInput('oracle_epm_edm_get_mapping_keys', params) },
  outputs: {
    mapKeys: edmOutputs.mapKeys,
  },
}
