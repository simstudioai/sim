import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmPlatformParams,
  OracleEpmPlatformResponse,
} from '@/tools/oracle_epm_platform/types'
import { ORACLE_EPM_STATUS_OUTPUTS } from '@/tools/oracle_epm_platform/types'
import { oracleEpmPlatformAuthParams } from '@/tools/oracle_epm_platform/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmPlatformDeleteFileTool: InternalToolConfig<
  OracleEpmPlatformParams<'delete_file'>,
  OracleEpmPlatformResponse<'delete_file'>
> = {
  id: 'oracle_epm_platform_delete_file',
  name: 'Oracle EPM Platform Delete File',
  description:
    'Delete a repository file or snapshot, not a folder. Requires Service Administrator or Migrations - Administer with an application role.',
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
  },
}
