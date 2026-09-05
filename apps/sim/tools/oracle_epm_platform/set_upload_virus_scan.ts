import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmPlatformParams,
  OracleEpmPlatformResponse,
} from '@/tools/oracle_epm_platform/types'
import { ORACLE_EPM_STATUS_OUTPUTS } from '@/tools/oracle_epm_platform/types'
import { oracleEpmPlatformAuthParams } from '@/tools/oracle_epm_platform/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmPlatformSetUploadVirusScanTool: InternalToolConfig<
  OracleEpmPlatformParams<'set_upload_virus_scan'>,
  OracleEpmPlatformResponse<'set_upload_virus_scan'>
> = {
  id: 'oracle_epm_platform_set_upload_virus_scan',
  name: 'Oracle EPM Platform Set Upload Virus Scan',
  description:
    'Enable or disable virus scanning on uploaded files. Requires Service Administrator.',
  version: '1.0.0',
  params: {
    ...oracleEpmPlatformAuthParams,
    enabled: {
      type: 'boolean',
      required: true,
      visibility: 'user-or-llm',
      description: 'Enable virus scanning on uploaded files',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    ...ORACLE_EPM_STATUS_OUTPUTS,
  },
}
