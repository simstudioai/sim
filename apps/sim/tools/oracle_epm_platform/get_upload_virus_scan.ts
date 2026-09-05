import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmPlatformParams,
  OracleEpmPlatformResponse,
} from '@/tools/oracle_epm_platform/types'
import { ORACLE_EPM_STATUS_OUTPUTS } from '@/tools/oracle_epm_platform/types'
import { oracleEpmPlatformAuthParams } from '@/tools/oracle_epm_platform/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmPlatformGetUploadVirusScanTool: InternalToolConfig<
  OracleEpmPlatformParams<'get_upload_virus_scan'>,
  OracleEpmPlatformResponse<'get_upload_virus_scan'>
> = {
  id: 'oracle_epm_platform_get_upload_virus_scan',
  name: 'Oracle EPM Platform Get Upload Virus Scan',
  description:
    'Read the environment upload virus-scanning setting. Requires Service Administrator.',
  version: '1.0.0',
  params: {
    ...oracleEpmPlatformAuthParams,
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    ...ORACLE_EPM_STATUS_OUTPUTS,
    enabled: { type: 'boolean', description: 'Whether virus scanning is enabled for file uploads' },
  },
}
