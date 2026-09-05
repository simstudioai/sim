import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmPlatformParams,
  OracleEpmPlatformResponse,
} from '@/tools/oracle_epm_platform/types'
import { ORACLE_EPM_STATUS_OUTPUTS } from '@/tools/oracle_epm_platform/types'
import { oracleEpmPlatformAuthParams } from '@/tools/oracle_epm_platform/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmPlatformSetRestrictedDataAccessTool: InternalToolConfig<
  OracleEpmPlatformParams<'set_restricted_data_access'>,
  OracleEpmPlatformResponse<'set_restricted_data_access'>
> = {
  id: 'oracle_epm_platform_set_restricted_data_access',
  name: 'Oracle EPM Platform Set Restricted Data Access',
  description:
    'Control whether application snapshots may be submitted through Provide Feedback. Requires Service Administrator.',
  version: '1.0.0',
  params: {
    ...oracleEpmPlatformAuthParams,
    enabled: {
      type: 'boolean',
      required: true,
      visibility: 'user-or-llm',
      description: 'Restrict snapshot submission through Provide Feedback',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    ...ORACLE_EPM_STATUS_OUTPUTS,
  },
}
