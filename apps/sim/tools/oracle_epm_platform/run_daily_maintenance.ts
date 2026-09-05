import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmPlatformParams,
  OracleEpmPlatformResponse,
} from '@/tools/oracle_epm_platform/types'
import { ORACLE_EPM_JOB_OUTPUTS } from '@/tools/oracle_epm_platform/types'
import { oracleEpmPlatformAuthParams } from '@/tools/oracle_epm_platform/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmPlatformRunDailyMaintenanceTool: InternalToolConfig<
  OracleEpmPlatformParams<'run_daily_maintenance'>,
  OracleEpmPlatformResponse<'run_daily_maintenance'>
> = {
  id: 'oracle_epm_platform_run_daily_maintenance',
  name: 'Oracle EPM Platform Run Daily Maintenance',
  description:
    'Start daily maintenance now, which can make the environment unavailable. Optionally skip the next scheduled maintenance. Requires Service Administrator or Migrations - Administer.',
  version: '1.0.0',
  params: {
    ...oracleEpmPlatformAuthParams,
    skipNext: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Skip the next scheduled daily maintenance; defaults to false',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    ...ORACLE_EPM_JOB_OUTPUTS,
  },
}
