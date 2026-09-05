import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { FccsClearDataProfileParams, FccsResponse } from '@/tools/oracle_epm_fccs/types'
import { FCCS_JOB_OUTPUTS } from '@/tools/oracle_epm_fccs/types'
import { fccsAuthParams, fccsParamFields } from '@/tools/oracle_epm_fccs/utils'
import type { InternalToolConfig } from '@/tools/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/fccs_clear_data.html */
export const oracleEpmFccsClearDataProfileTool: InternalToolConfig<
  FccsClearDataProfileParams,
  FccsResponse
> = {
  id: 'oracle_epm_fccs_clear_data_profile',
  name: 'Oracle EPM FCCS Clear Data Profile',
  description: 'Submit an existing FCCS Clear Data profile by its exact tenant-defined name.',
  version: '1.0.0',
  params: {
    ...fccsAuthParams,
    application: fccsParamFields.application,
    profileName: fccsParamFields.profileName,
  },
  operation: { input: createInternalToolOperationInput },
  outputs: FCCS_JOB_OUTPUTS,
}
