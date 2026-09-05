import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmPlatformParams,
  OracleEpmPlatformResponse,
} from '@/tools/oracle_epm_platform/types'
import { ORACLE_EPM_JOB_OUTPUTS } from '@/tools/oracle_epm_platform/types'
import { oracleEpmPlatformAuthParams } from '@/tools/oracle_epm_platform/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmPlatformExportSnapshotTool: InternalToolConfig<
  OracleEpmPlatformParams<'export_snapshot'>,
  OracleEpmPlatformResponse<'export_snapshot'>
> = {
  id: 'oracle_epm_platform_export_snapshot',
  name: 'Oracle EPM Platform Export Snapshot',
  description:
    'Repeat an export using the existing snapshot export settings configured in Migration. This does not create arbitrary export definitions. Requires Service Administrator or Migrations - Administer.',
  version: '1.0.0',
  params: {
    ...oracleEpmPlatformAuthParams,
    snapshotName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Existing Migration snapshot name',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    ...ORACLE_EPM_JOB_OUTPUTS,
  },
}
