import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmPlatformParams,
  OracleEpmPlatformResponse,
} from '@/tools/oracle_epm_platform/types'
import { ORACLE_EPM_STATUS_OUTPUTS } from '@/tools/oracle_epm_platform/types'
import { oracleEpmPlatformAuthParams } from '@/tools/oracle_epm_platform/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmPlatformRenameSnapshotTool: InternalToolConfig<
  OracleEpmPlatformParams<'rename_snapshot'>,
  OracleEpmPlatformResponse<'rename_snapshot'>
> = {
  id: 'oracle_epm_platform_rename_snapshot',
  name: 'Oracle EPM Platform Rename Snapshot',
  description:
    'Rename an existing Migration snapshot. Requires Service Administrator or Migrations - Administer. This operation returns its synchronous outcome.',
  version: '1.0.0',
  params: {
    ...oracleEpmPlatformAuthParams,
    snapshotName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Existing Migration snapshot name',
    },
    newSnapshotName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'New snapshot name',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    ...ORACLE_EPM_STATUS_OUTPUTS,
  },
}
