import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmPlatformParams,
  OracleEpmPlatformResponse,
} from '@/tools/oracle_epm_platform/types'
import { ORACLE_EPM_JOB_OUTPUTS } from '@/tools/oracle_epm_platform/types'
import { oracleEpmPlatformAuthParams } from '@/tools/oracle_epm_platform/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmPlatformImportSnapshotTool: InternalToolConfig<
  OracleEpmPlatformParams<'import_snapshot'>,
  OracleEpmPlatformResponse<'import_snapshot'>
> = {
  id: 'oracle_epm_platform_import_snapshot',
  name: 'Oracle EPM Platform Import Snapshot',
  description:
    'Import a Migration snapshot into this environment. Requires Service Administrator or Migrations - Administer; importing identity-domain users and application roles additionally requires Identity Domain Administrator.',
  version: '1.0.0',
  params: {
    ...oracleEpmPlatformAuthParams,
    snapshotName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Existing Migration snapshot name',
    },
    importUsers: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Import identity-domain users and application roles; defaults to false',
    },
    userPassword: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Optional operator-controlled password for imported users; omit for unique temporary passwords',
    },
    resetPassword: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Require imported users to reset passwords at first login; defaults to true when importing users',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    ...ORACLE_EPM_JOB_OUTPUTS,
  },
}
