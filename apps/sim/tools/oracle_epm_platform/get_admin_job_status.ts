import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmPlatformParams,
  OracleEpmPlatformResponse,
} from '@/tools/oracle_epm_platform/types'
import { ORACLE_EPM_JOB_OUTPUTS } from '@/tools/oracle_epm_platform/types'
import { oracleEpmPlatformAuthParams } from '@/tools/oracle_epm_platform/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmPlatformGetAdminJobStatusTool: InternalToolConfig<
  OracleEpmPlatformParams<'get_admin_job_status'>,
  OracleEpmPlatformResponse<'get_admin_job_status'>
> = {
  id: 'oracle_epm_platform_get_admin_job_status',
  name: 'Oracle EPM Platform Get Admin Job Status',
  description:
    'Read an administrative migration, maintenance, or snapshot-upload extraction job. Defaults to one status read. Optional waiting is bounded to two minutes and the remaining execution deadline.',
  version: '1.0.0',
  params: {
    ...oracleEpmPlatformAuthParams,
    jobId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Numeric job ID returned by an administrative starter',
    },
    jobKind: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Job kind: migration, maintenance, or snapshot_upload',
    },
    waitForCompletion: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Wait for terminal status within bounded attempts/deadlines; defaults to false',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    ...ORACLE_EPM_JOB_OUTPUTS,
  },
}
