import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OraclePcmGenerateProgramDocumentationParams,
  OraclePcmResponse,
} from '@/tools/oracle_epm_profitability/types'
import { ORACLE_PCM_TASK_OUTPUTS } from '@/tools/oracle_epm_profitability/types'
import { oraclePcmAuthParams, oraclePcmOAuth } from '@/tools/oracle_epm_profitability/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oraclePcmGenerateProgramDocumentationTool: InternalToolConfig<
  OraclePcmGenerateProgramDocumentationParams,
  OraclePcmResponse
> = {
  id: 'oracle_epm_profitability_generate_program_documentation',
  name: 'Oracle PCM Generate Program Documentation',
  description:
    'Submit a PCM program documentation report to profitoutbox. Available to all application roles; status polling requires Service Administrator or Power User. Submission is separate from waiting; do not blindly retry an ambiguous failure.',
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
    povName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'POV members joined by stringDelimiter; model POV for calculations',
    },
    fileName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filename without a folder for upload/import/export; download uses the listed profitoutbox path',
    },
    fileType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Program documentation format Allowed values: PDF, XML, WORD, EXCEL, HTML.',
      default: 'PDF',
    },
    skipFilters: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Use level-0 member counts instead of resolving rule filters in documentation',
      default: false,
    },
    subsetStart: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'First rule-set sequence; required for RULESET_SUBSET',
    },
    subsetEnd: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Last rule-set sequence; required for RULESET_SUBSET',
    },
    useAlias: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Use aliases in the program documentation report',
      default: false,
    },
    stringDelimiter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Single separator: defaults to underscore for POVs and comma for dimension file lists',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: ORACLE_PCM_TASK_OUTPUTS,
}
