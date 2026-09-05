import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmPlatformParams,
  OracleEpmPlatformResponse,
} from '@/tools/oracle_epm_platform/types'
import { ORACLE_EPM_STATUS_OUTPUTS } from '@/tools/oracle_epm_platform/types'
import { oracleEpmPlatformAuthParams } from '@/tools/oracle_epm_platform/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmPlatformSetMaintenanceWindowTool: InternalToolConfig<
  OracleEpmPlatformParams<'set_maintenance_window'>,
  OracleEpmPlatformResponse<'set_maintenance_window'>
> = {
  id: 'oracle_epm_platform_set_maintenance_window',
  name: 'Oracle EPM Platform Set Maintenance Window',
  description:
    'Set the environment daily maintenance start time. Requires Service Administrator or Migrations - Administer.',
  version: '1.0.0',
  params: {
    ...oracleEpmPlatformAuthParams,
    startTime: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Start time from 00:00 through 23:59 (HH:MM), optionally followed by a space and a standard time zone such as 14:35 America/Los_Angeles',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    ...ORACLE_EPM_STATUS_OUTPUTS,
  },
}
