import type {
  OracleEpmEdmListApplicationsParams,
  OracleEpmEdmListApplicationsResponse,
} from '@/tools/oracle_epm_enterprise_data_management/types'
import {
  edmAuthParams,
  edmOperationInput,
  edmOutputs,
  edmParam,
} from '@/tools/oracle_epm_enterprise_data_management/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmEdmListApplicationsTool: InternalToolConfig<
  OracleEpmEdmListApplicationsParams,
  OracleEpmEdmListApplicationsResponse
> = {
  id: 'oracle_epm_edm_list_applications',
  name: 'Oracle EDM List Applications',
  description: 'List applications visible to the EDM credential, with bounded documented metadata.',
  version: '1.0.0',
  oauth: {
    required: true,
    provider: 'oracle-epm-enterprise-data-management',
    credentialKind: 'service-account',
    authoritativeParams: ['instanceUrl'],
  },
  params: {
    ...edmAuthParams,
    applicationId: edmParam('string', false, 'Application UUID'),
    permission: edmParam(
      'string',
      false,
      'One application permission: owner, datamanager, participant, or participant_with_write. Allowed values: owner, datamanager, participant, participant_with_write.'
    ),
    maxResults: edmParam(
      'number',
      false,
      'Maximum projected items (1-500; default 200). This is a local result cap, not provider pagination.'
    ),
  },
  operation: { input: (params) => edmOperationInput('oracle_epm_edm_list_applications', params) },
  outputs: {
    applications: edmOutputs.applications,
  },
}
