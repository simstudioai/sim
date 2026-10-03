import type {
  OracleEpmEdmAssignRequestParams,
  OracleEpmEdmAssignRequestResponse,
} from '@/tools/oracle_epm_enterprise_data_management/types'
import {
  edmAuthParams,
  edmOperationInput,
  edmOutputs,
  edmParam,
} from '@/tools/oracle_epm_enterprise_data_management/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmEdmAssignRequestTool: InternalToolConfig<
  OracleEpmEdmAssignRequestParams,
  OracleEpmEdmAssignRequestResponse
> = {
  id: 'oracle_epm_edm_assign_request',
  name: 'Oracle EDM Assign Request',
  description: 'Assign an EDM request number to a user.',
  version: '1.0.0',
  oauth: {
    required: true,
    provider: 'oracle-epm-enterprise-data-management',
    credentialKind: 'service-account',
    authoritativeParams: ['instanceUrl'],
  },
  params: {
    ...edmAuthParams,
    requestNumber: edmParam('number', true, 'Positive Oracle request number, not request UUID'),
    userName: edmParam('string', true, 'Oracle user name to receive the request'),
    comment: edmParam('string', false, 'Workflow or assignment comment'),
  },
  operation: { input: (params) => edmOperationInput('oracle_epm_edm_assign_request', params) },
  outputs: {
    request: edmOutputs.request,
  },
}
