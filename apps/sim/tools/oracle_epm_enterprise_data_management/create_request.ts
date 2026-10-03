import type {
  OracleEpmEdmCreateRequestParams,
  OracleEpmEdmCreateRequestResponse,
} from '@/tools/oracle_epm_enterprise_data_management/types'
import {
  edmAuthParams,
  edmOperationInput,
  edmOutputs,
  edmParam,
} from '@/tools/oracle_epm_enterprise_data_management/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmEdmCreateRequestTool: InternalToolConfig<
  OracleEpmEdmCreateRequestParams,
  OracleEpmEdmCreateRequestResponse
> = {
  id: 'oracle_epm_edm_create_request',
  name: 'Oracle EDM Create Request',
  description: 'Create an interactive EDM request in a selected view.',
  version: '1.0.0',
  oauth: {
    required: true,
    provider: 'oracle-epm-enterprise-data-management',
    credentialKind: 'service-account',
    authoritativeParams: ['instanceUrl'],
  },
  params: {
    ...edmAuthParams,
    viewId: edmParam('string', true, 'View UUID'),
    title: edmParam('string', false, 'Request title'),
    description: edmParam('string', false, 'Request description'),
    notes: edmParam('string', false, 'Request notes'),
    priority: edmParam(
      'string',
      false,
      'Priority for a new request. Allowed values: NONE, LOW, MEDIUM, HIGH.'
    ),
    timeLabelName: edmParam('string', false, 'Time label name; request queries support one value'),
  },
  operation: { input: (params) => edmOperationInput('oracle_epm_edm_create_request', params) },
  outputs: {
    request: edmOutputs.request,
  },
}
