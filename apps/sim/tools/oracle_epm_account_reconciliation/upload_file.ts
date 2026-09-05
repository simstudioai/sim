import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmAccountReconciliationResponse,
  OracleEpmAccountReconciliationUploadFileParams,
} from '@/tools/oracle_epm_account_reconciliation/types'
import { ARCS_UPLOAD_OUTPUTS } from '@/tools/oracle_epm_account_reconciliation/types'
import { arcsAuthParamFields } from '@/tools/oracle_epm_account_reconciliation/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmAccountReconciliationUploadFileTool: InternalToolConfig<
  OracleEpmAccountReconciliationUploadFileParams,
  OracleEpmAccountReconciliationResponse
> = {
  id: 'oracle_epm_account_reconciliation_upload_file',
  name: 'Oracle EPM Account Reconciliation Upload File',
  description: 'Upload a Sim file to the EPM repository without overwriting an existing file.',
  version: '1.0.0',
  params: {
    ...arcsAuthParamFields,
    file: {
      type: 'file',
      required: true,
      visibility: 'user-or-llm',
      description: 'Sim file to upload',
    },
    fileName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Destination repository filename; defaults to the source filename',
    },
    extDirPath: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional Data Management directory, such as inbox or inbox/data',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: ARCS_UPLOAD_OUTPUTS,
}
