import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmPlatformParams,
  OracleEpmPlatformResponse,
} from '@/tools/oracle_epm_platform/types'
import { ORACLE_EPM_STATUS_OUTPUTS } from '@/tools/oracle_epm_platform/types'
import { oracleEpmPlatformAuthParams } from '@/tools/oracle_epm_platform/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmPlatformGetIdleSessionTimeoutTool: InternalToolConfig<
  OracleEpmPlatformParams<'get_idle_session_timeout'>,
  OracleEpmPlatformResponse<'get_idle_session_timeout'>
> = {
  id: 'oracle_epm_platform_get_idle_session_timeout',
  name: 'Oracle EPM Platform Get Idle Session Timeout',
  description:
    'Read the environment idle-session timeout in minutes. Requires Service Administrator.',
  version: '1.0.0',
  params: {
    ...oracleEpmPlatformAuthParams,
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    ...ORACLE_EPM_STATUS_OUTPUTS,
    timeoutMinutes: { type: 'number', description: 'Idle timeout in minutes' },
  },
}
