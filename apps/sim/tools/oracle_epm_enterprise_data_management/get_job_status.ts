import type {
  OracleEpmEdmGetJobStatusParams,
  OracleEpmEdmGetJobStatusResponse,
} from '@/tools/oracle_epm_enterprise_data_management/types'
import {
  edmAuthParams,
  edmOperationInput,
  edmOutputs,
  edmParam,
} from '@/tools/oracle_epm_enterprise_data_management/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmEdmGetJobStatusTool: InternalToolConfig<
  OracleEpmEdmGetJobStatusParams,
  OracleEpmEdmGetJobStatusResponse
> = {
  id: 'oracle_epm_edm_get_job_status',
  name: 'Oracle EDM Get Job Status',
  description: 'Get the current Oracle EDM job status without waiting.',
  version: '1.0.0',
  oauth: {
    required: true,
    provider: 'oracle-epm-enterprise-data-management',
    credentialKind: 'service-account',
    authoritativeParams: ['instanceUrl'],
  },
  params: {
    ...edmAuthParams,
    jobRunId: edmParam('string', true, 'Oracle job UUID'),
  },
  operation: { input: (params) => edmOperationInput('oracle_epm_edm_get_job_status', params) },
  outputs: {
    job: edmOutputs.job,
  },
}
