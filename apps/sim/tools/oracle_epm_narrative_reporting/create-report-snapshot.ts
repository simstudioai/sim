import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  NarrativeResponse,
  NarrativeToolParams,
} from '@/tools/oracle_epm_narrative_reporting/types'
import { narrativeAuthParams, narrativeOAuth } from '@/tools/oracle_epm_narrative_reporting/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmNarrativeReportingCreateReportSnapshotTool: InternalToolConfig<
  NarrativeToolParams,
  NarrativeResponse
> = {
  id: 'oracle_epm_narrative_reporting_create_report_snapshot',
  name: 'Oracle EPM Narrative Reporting Create Report Snapshot',
  description:
    'Submit a report snapshot creation job. Use Wait for Job separately to establish completion.',
  version: '1.0.0',
  oauth: narrativeOAuth,
  params: {
    ...narrativeAuthParams,
    ...{
      reportId: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Native report ID. Provide reportId or reportName.',
      },
      reportName: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Library report name or path. Required when reportId is omitted.',
      },
      libraryLocation: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Optional destination folder for the report snapshot.',
      },
      snapShotName: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Optional report snapshot name (Oracle spelling is snapShotName).',
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
      overwrite: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Whether to overwrite the report snapshot: string "true" or "false".',
      },
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    job: {
      type: 'object',
      description: 'Documented Job metadata; unknown fields and returned URLs are omitted',
      properties: {
        jobId: {
          type: 'string',
          description: 'Oracle job ID; preserved on local timeout',
        },
        status: {
          type: 'number',
          description:
            'Oracle status: -1 pending, 0 success, 1 error, 3 cancelled; other values are not treated as completion',
        },
        descriptiveStatus: {
          type: 'string',
          description: 'descriptiveStatus',
          nullable: true,
        },
        details: {
          type: 'string',
          description: 'details',
          nullable: true,
        },
        jobName: {
          type: 'string',
          description: 'jobName',
          nullable: true,
        },
        jobType: {
          type: 'string',
          description: 'jobType',
          nullable: true,
        },
      },
    },
  },
}
