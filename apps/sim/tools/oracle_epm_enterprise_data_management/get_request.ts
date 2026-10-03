import type {
  OracleEpmEdmGetRequestParams,
  OracleEpmEdmGetRequestResponse,
} from '@/tools/oracle_epm_enterprise_data_management/types'
import {
  edmAuthParams,
  edmOperationInput,
  edmOutputs,
  edmParam,
} from '@/tools/oracle_epm_enterprise_data_management/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmEdmGetRequestTool: InternalToolConfig<
  OracleEpmEdmGetRequestParams,
  OracleEpmEdmGetRequestResponse
> = {
  id: 'oracle_epm_edm_get_request',
  name: 'Oracle EDM Get Request',
  description:
    'Get request status, ownership, valid transitions, and subscription source relationships.',
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
  operation: { input: (params) => edmOperationInput('oracle_epm_edm_get_request', params) },
  outputs: {
    request: edmOutputs.request,
  },
}
