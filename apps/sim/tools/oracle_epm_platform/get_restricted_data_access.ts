import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmPlatformParams,
  OracleEpmPlatformResponse,
} from '@/tools/oracle_epm_platform/types'
import { ORACLE_EPM_STATUS_OUTPUTS } from '@/tools/oracle_epm_platform/types'
import { oracleEpmPlatformAuthParams } from '@/tools/oracle_epm_platform/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmPlatformGetRestrictedDataAccessTool: InternalToolConfig<
  OracleEpmPlatformParams<'get_restricted_data_access'>,
  OracleEpmPlatformResponse<'get_restricted_data_access'>
> = {
  id: 'oracle_epm_platform_get_restricted_data_access',
  name: 'Oracle EPM Platform Get Restricted Data Access',
  description:
    'Read whether users are prevented from submitting an application snapshot through Provide Feedback. This setting is not an application data-permission report. Requires Service Administrator.',
  version: '1.0.0',
  params: {
    ...oracleEpmPlatformAuthParams,
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    ...ORACLE_EPM_STATUS_OUTPUTS,
    enabled: {
      type: 'boolean',
      description: 'Whether submitting snapshots through Provide Feedback is restricted',
    },
  },
}
