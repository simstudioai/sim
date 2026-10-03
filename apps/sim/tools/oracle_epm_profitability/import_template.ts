import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OraclePcmImportTemplateParams,
  OraclePcmResponse,
} from '@/tools/oracle_epm_profitability/types'
import { ORACLE_PCM_TASK_OUTPUTS } from '@/tools/oracle_epm_profitability/types'
import { oraclePcmAuthParams, oraclePcmOAuth } from '@/tools/oracle_epm_profitability/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oraclePcmImportTemplateTool: InternalToolConfig<
  OraclePcmImportTemplateParams,
  OraclePcmResponse
> = {
  id: 'oracle_epm_profitability_import_template',
  name: 'Oracle PCM Import Template',
  description:
    'Import a PCM application template ZIP already staged in profitinbox. Requires Service Administrator or Power User. Submission is separate from waiting; do not blindly retry an ambiguous failure.',
  version: '1.0.0',
  oauth: oraclePcmOAuth,
  params: {
    ...oraclePcmAuthParams,
    applicationName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Exact PCM Management Ledger application name',
    },
    description: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Description of the application',
    },
    fileName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Filename without a folder for upload/import/export; download uses the listed profitoutbox path',
    },
    isApplicationOverwrite: {
      type: 'boolean',
      required: true,
      visibility: 'user-or-llm',
      description: 'Overwrite an application with the same name when importing',
      default: false,
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: ORACLE_PCM_TASK_OUTPUTS,
}
