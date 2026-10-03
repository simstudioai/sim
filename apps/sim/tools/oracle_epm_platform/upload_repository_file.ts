import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmPlatformParams,
  OracleEpmPlatformResponse,
} from '@/tools/oracle_epm_platform/types'
import { ORACLE_EPM_JOB_OUTPUTS } from '@/tools/oracle_epm_platform/types'
import { oracleEpmPlatformAuthParams } from '@/tools/oracle_epm_platform/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmPlatformUploadRepositoryFileTool: InternalToolConfig<
  OracleEpmPlatformParams<'upload_repository_file'>,
  OracleEpmPlatformResponse<'upload_repository_file'>
> = {
  id: 'oracle_epm_platform_upload_repository_file',
  name: 'Oracle EPM Platform Upload Repository File',
  description:
    'Upload one authorized Sim UserFile of at most 100 MiB to the repository. Existing files are not overwritten. For large snapshots use Upload Snapshot. Requires Service Administrator or Migrations - Administer with an application role.',
  version: '1.0.0',
  params: {
    ...oracleEpmPlatformAuthParams,
    file: {
      type: 'file',
      required: true,
      visibility: 'user-or-llm',
      description: 'Canonical uploaded UserFile (at most 100 MiB)',
    },
    fileName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'New destination file name or repository path; existing files cannot be overwritten',
    },
    directory: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Optional supported destination: inbox, outbox, profitinbox, profitoutbox, a subdirectory of these, or Narrative Reporting to_be_imported',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    ...ORACLE_EPM_JOB_OUTPUTS,
    fileName: { type: 'string', description: 'Uploaded destination name' },
    bytesUploaded: { type: 'number', description: 'Verified bytes uploaded' },
  },
}
