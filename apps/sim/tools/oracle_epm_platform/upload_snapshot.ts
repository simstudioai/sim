import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmPlatformParams,
  OracleEpmPlatformResponse,
} from '@/tools/oracle_epm_platform/types'
import { ORACLE_EPM_JOB_OUTPUTS } from '@/tools/oracle_epm_platform/types'
import { oracleEpmPlatformAuthParams } from '@/tools/oracle_epm_platform/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmPlatformUploadSnapshotTool: InternalToolConfig<
  OracleEpmPlatformParams<'upload_snapshot'>,
  OracleEpmPlatformResponse<'upload_snapshot'>
> = {
  id: 'oracle_epm_platform_upload_snapshot',
  name: 'Oracle EPM Platform Upload Snapshot',
  description:
    'Upload a Migration snapshot ZIP from an authorized Sim UserFile, up to 5 GiB, in sequential chunks of at most 50 MiB. Existing files are not overwritten. Return the extraction job when asynchronous. Requires Service Administrator or Migrations - Administer.',
  version: '1.0.0',
  params: {
    ...oracleEpmPlatformAuthParams,
    file: {
      type: 'file',
      required: true,
      visibility: 'user-or-llm',
      description: 'Canonical uploaded ZIP UserFile (at most 5 GiB)',
    },
    snapshotName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'New snapshot upload file name ending in .zip',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    ...ORACLE_EPM_JOB_OUTPUTS,
    snapshotName: { type: 'string', description: 'Uploaded snapshot ZIP name' },
    bytesUploaded: { type: 'number', description: 'Verified bytes uploaded' },
  },
}
