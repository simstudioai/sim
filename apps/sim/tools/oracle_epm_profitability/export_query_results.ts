import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OraclePcmExportQueryResultsParams,
  OraclePcmResponse,
} from '@/tools/oracle_epm_profitability/types'
import { ORACLE_PCM_TASK_OUTPUTS } from '@/tools/oracle_epm_profitability/types'
import { oraclePcmAuthParams, oraclePcmOAuth } from '@/tools/oracle_epm_profitability/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oraclePcmExportQueryResultsTool: InternalToolConfig<
  OraclePcmExportQueryResultsParams,
  OraclePcmResponse
> = {
  id: 'oracle_epm_profitability_export_query_results',
  name: 'Oracle PCM Export Query Results',
  description:
    'Export an existing PCM query or application data to profitoutbox. Available to all application roles; status polling requires Service Administrator or Power User. Submission is separate from waiting; do not blindly retry an ambiguous failure.',
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
    fileName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Filename without a folder for upload/import/export; download uses the listed profitoutbox path',
    },
    queryName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Existing PCM query; exports with no query export all application data',
    },
    exportOnlyLevel0Flg: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Export only level-0 query data; ignored when exporting the whole application',
      default: false,
    },
    fileOutputOptions: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Export compression and text-file output Allowed values: ZIP_ONLY, ZIP_AND_TEXT, TEXT_ONLY.',
      default: 'ZIP_ONLY',
    },
    roundingPrecision: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Decimal places for named query exports; Oracle defaults to 2',
    },
    dataFormat: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'NATIVE exports query data; COLUMNAR exports application data and ignores queryName Allowed values: NATIVE, COLUMNAR.',
      default: 'NATIVE',
    },
    memberFilters: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON string mapping dimensions to level-0 member arrays; applies to COLUMNAR exports',
    },
    includeHeader: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include dimension column headers for COLUMNAR exports',
      default: true,
    },
    delimiter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Single column separator for COLUMNAR exports; Oracle defaults to space',
    },
    keepDuplicateMemberFormat: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Use qualified duplicate member names for COLUMNAR exports',
      default: true,
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: ORACLE_PCM_TASK_OUTPUTS,
}
