import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  NarrativeResponse,
  NarrativeToolParams,
} from '@/tools/oracle_epm_narrative_reporting/types'
import { narrativeAuthParams, narrativeOAuth } from '@/tools/oracle_epm_narrative_reporting/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmNarrativeReportingDownloadReportOutputTool: InternalToolConfig<
  NarrativeToolParams,
  NarrativeResponse
> = {
  id: 'oracle_epm_narrative_reporting_download_report_output',
  name: 'Oracle EPM Narrative Reporting Download Report Output',
  description: 'Render a report as PDF and store it as a UserFile. Maximum download 100 MiB.',
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
      prompts: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Comma-separated promptId:selection values; semicolons separate multiple selections.',
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
