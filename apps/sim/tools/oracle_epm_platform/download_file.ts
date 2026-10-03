import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmPlatformParams,
  OracleEpmPlatformResponse,
} from '@/tools/oracle_epm_platform/types'
import { ORACLE_EPM_STATUS_OUTPUTS } from '@/tools/oracle_epm_platform/types'
import { oracleEpmPlatformAuthParams } from '@/tools/oracle_epm_platform/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmPlatformDownloadFileTool: InternalToolConfig<
  OracleEpmPlatformParams<'download_file'>,
  OracleEpmPlatformResponse<'download_file'>
> = {
  id: 'oracle_epm_platform_download_file',
  name: 'Oracle EPM Platform Download File',
  description:
    'Download a current repository file or snapshot to a Sim UserFile, with a strict 100 MiB output limit. Poll snapshot compression when necessary and clean up the operation-owned temporary download. Requires Service Administrator or Migrations - Administer with an application role.',
  version: '1.0.0',
  params: {
    ...oracleEpmPlatformAuthParams,
    fileName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Exact repository file or snapshot name, including any repository folders',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    ...ORACLE_EPM_STATUS_OUTPUTS,
    file: { type: 'file', description: 'Downloaded UserFile, at most 100 MiB' },
    cleanupComplete: {
      type: 'boolean',
      description: 'Whether temporary snapshot cleanup succeeded or was unnecessary',
    },
  },
}
