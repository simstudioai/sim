import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmPlatformParams,
  OracleEpmPlatformResponse,
} from '@/tools/oracle_epm_platform/types'
import { ORACLE_EPM_STATUS_OUTPUTS } from '@/tools/oracle_epm_platform/types'
import { oracleEpmPlatformAuthParams } from '@/tools/oracle_epm_platform/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmPlatformGetEnvironmentInfoTool: InternalToolConfig<
  OracleEpmPlatformParams<'get_environment_info'>,
  OracleEpmPlatformResponse<'get_environment_info'>
> = {
  id: 'oracle_epm_platform_get_environment_info',
  name: 'Oracle EPM Platform Get Environment Info',
  description:
    'Read the environment build version, daily maintenance start time, and time zone. Requires Service Administrator or Migrations - Administer.',
  version: '1.0.0',
  params: {
    ...oracleEpmPlatformAuthParams,
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    ...ORACLE_EPM_STATUS_OUTPUTS,
    environments: {
      type: 'array',
      description: 'Environment build and maintenance settings',
      items: {
        type: 'object',
        properties: {
          buildVersion: { type: 'string', description: 'Current environment build' },
          maintenanceStartTime: { type: 'string', description: 'Daily maintenance start time' },
          timeZone: {
            type: 'string',
            optional: true,
            description: 'Maintenance time zone when returned',
          },
        },
      },
    },
  },
}
