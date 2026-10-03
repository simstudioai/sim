import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmDataResponse,
  OracleEpmDataUploadFileParams,
} from '@/tools/oracle_epm_data/types'
import {
  ORACLE_EPM_DATA_FILE_STATUS_OUTPUTS,
  oracleEpmDataAuthParamFields,
  oracleEpmDataOAuth,
} from '@/tools/oracle_epm_data/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmDataUploadFileTool: InternalToolConfig<
  OracleEpmDataUploadFileParams,
  OracleEpmDataResponse
> = {
  id: 'oracle_epm_data_upload_file',
  name: 'Oracle EPM Data Upload File',
  description:
    'Upload one authorized UserFile of at most 100 MiB to the EPM repository without overwriting existing files.',
  version: '1.0.0',
  oauth: oracleEpmDataOAuth,
  params: {
    ...oracleEpmDataAuthParamFields,
    file: {
      type: 'file',
      required: true,
      visibility: 'user-or-llm',
      description: 'One uploaded UserFile or resolved prior-block file reference; maximum 100 MiB',
    },
    fileName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Raw destination filename, not a URL-encoded path',
    },
    extDirPath: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Oracle upload directory such as inbox, inbox/subfolder, or outbox; omit to use repository root',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: ORACLE_EPM_DATA_FILE_STATUS_OUTPUTS,
}
