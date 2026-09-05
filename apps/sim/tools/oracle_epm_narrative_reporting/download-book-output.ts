import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  NarrativeResponse,
  NarrativeToolParams,
} from '@/tools/oracle_epm_narrative_reporting/types'
import { narrativeAuthParams, narrativeOAuth } from '@/tools/oracle_epm_narrative_reporting/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmNarrativeReportingDownloadBookOutputTool: InternalToolConfig<
  NarrativeToolParams,
  NarrativeResponse
> = {
  id: 'oracle_epm_narrative_reporting_download_book_output',
  name: 'Oracle EPM Narrative Reporting Download Book Output',
  description:
    'Render a book as PDF or XLSX using a bodyless POST and store it as a UserFile, up to 100 MiB.',
  version: '1.0.0',
  oauth: narrativeOAuth,
  params: {
    ...narrativeAuthParams,
    ...{
      resourceId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Native resource ID returned by its matching discovery operation.',
      },
      format: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Book output format: pdf (default) or xlsx.',
      },
      fileName: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Optional output filename. Downloads are stored as UserFile objects and capped at 100 MiB.',
      },
      globalPov: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Comma-separated dimension:member selections.',
      },
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    file: {
      type: 'file',
      description: 'Canonical execution UserFile, never inline base64; maximum 100 MiB',
    },
  },
}
