import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmPlatformParams,
  OracleEpmPlatformResponse,
} from '@/tools/oracle_epm_platform/types'
import { ORACLE_EPM_STATUS_OUTPUTS } from '@/tools/oracle_epm_platform/types'
import { oracleEpmPlatformAuthParams } from '@/tools/oracle_epm_platform/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmPlatformGetSnapshotTool: InternalToolConfig<
  OracleEpmPlatformParams<'get_snapshot'>,
  OracleEpmPlatformResponse<'get_snapshot'>
> = {
  id: 'oracle_epm_platform_get_snapshot',
  name: 'Oracle EPM Platform Get Snapshot',
  description:
    'Read documented snapshot capabilities (export, import, upload, download). Requires Service Administrator. Does not inspect product-specific artifact schemas.',
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
    ...ORACLE_EPM_STATUS_OUTPUTS,
    snapshots: {
      type: 'array',
      description: 'Requested snapshot capabilities',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Snapshot name' },
          type: { type: 'string', description: 'LCM or EXTERNAL' },
          canExport: {
            type: 'boolean',
            description: 'Whether Oracle permits exporting this snapshot',
          },
          canImport: {
            type: 'boolean',
            description: 'Whether Oracle permits importing this snapshot',
          },
          canUpload: {
            type: 'boolean',
            description: 'Whether Oracle permits uploading this snapshot',
          },
          canDownload: {
            type: 'boolean',
            description: 'Whether Oracle permits downloading this snapshot',
          },
        },
      },
    },
  },
}
