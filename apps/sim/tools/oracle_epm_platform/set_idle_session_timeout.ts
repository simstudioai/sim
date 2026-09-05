import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmPlatformParams,
  OracleEpmPlatformResponse,
} from '@/tools/oracle_epm_platform/types'
import { ORACLE_EPM_STATUS_OUTPUTS } from '@/tools/oracle_epm_platform/types'
import { oracleEpmPlatformAuthParams } from '@/tools/oracle_epm_platform/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmPlatformSetIdleSessionTimeoutTool: InternalToolConfig<
  OracleEpmPlatformParams<'set_idle_session_timeout'>,
  OracleEpmPlatformResponse<'set_idle_session_timeout'>
> = {
  id: 'oracle_epm_platform_set_idle_session_timeout',
  name: 'Oracle EPM Platform Set Idle Session Timeout',
  description:
    'Set the environment idle-session timeout (15–480 minutes). Takes effect after the next daily maintenance. Requires Service Administrator.',
  version: '1.0.0',
  params: {
    ...oracleEpmPlatformAuthParams,
    timeoutMinutes: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Idle timeout in minutes, integer from 15 to 480',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    ...ORACLE_EPM_STATUS_OUTPUTS,
  },
}
