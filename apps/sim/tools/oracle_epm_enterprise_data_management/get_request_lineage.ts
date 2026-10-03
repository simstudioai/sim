import type {
  OracleEpmEdmGetRequestLineageParams,
  OracleEpmEdmGetRequestLineageResponse,
} from '@/tools/oracle_epm_enterprise_data_management/types'
import {
  edmAuthParams,
  edmOperationInput,
  edmOutputs,
  edmParam,
} from '@/tools/oracle_epm_enterprise_data_management/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmEdmGetRequestLineageTool: InternalToolConfig<
  OracleEpmEdmGetRequestLineageParams,
  OracleEpmEdmGetRequestLineageResponse
> = {
  id: 'oracle_epm_edm_get_request_lineage',
  name: 'Oracle EDM Get Request Lineage',
  description: 'Inspect request lineage and subscription processing relationships.',
  version: '1.0.0',
  oauth: {
    required: true,
    provider: 'oracle-epm-enterprise-data-management',
    credentialKind: 'service-account',
    authoritativeParams: ['instanceUrl'],
  },
  params: {
    ...edmAuthParams,
    requestId: edmParam('string', true, 'Request UUID; for node listing it requires request scope'),
  },
  operation: { input: (params) => edmOperationInput('oracle_epm_edm_get_request_lineage', params) },
  outputs: {
    lineage: edmOutputs.lineage,
  },
}
