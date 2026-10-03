import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { FccsCopyDataProfileParams, FccsResponse } from '@/tools/oracle_epm_fccs/types'
import { FCCS_JOB_OUTPUTS } from '@/tools/oracle_epm_fccs/types'
import { fccsAuthParams, fccsParamFields } from '@/tools/oracle_epm_fccs/utils'
import type { InternalToolConfig } from '@/tools/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/fccs_copy_data.html */
export const oracleEpmFccsCopyDataProfileTool: InternalToolConfig<
  FccsCopyDataProfileParams,
  FccsResponse
> = {
  id: 'oracle_epm_fccs_copy_data_profile',
  name: 'Oracle EPM FCCS Copy Data Profile',
  description: 'Submit an existing FCCS Copy Data profile by its exact tenant-defined name.',
  version: '1.0.0',
  params: {
    ...fccsAuthParams,
    application: fccsParamFields.application,
    profileName: fccsParamFields.profileName,
  },
  operation: { input: createInternalToolOperationInput },
  outputs: FCCS_JOB_OUTPUTS,
}
