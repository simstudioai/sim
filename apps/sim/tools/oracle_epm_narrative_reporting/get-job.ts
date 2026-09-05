import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  NarrativeResponse,
  NarrativeToolParams,
} from '@/tools/oracle_epm_narrative_reporting/types'
import { narrativeAuthParams, narrativeOAuth } from '@/tools/oracle_epm_narrative_reporting/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmNarrativeReportingGetJobTool: InternalToolConfig<
  NarrativeToolParams,
  NarrativeResponse
> = {
  id: 'oracle_epm_narrative_reporting_get_job',
  name: 'Oracle EPM Narrative Reporting Get Job',
  description: 'Read job status without waiting or following artifact result links.',
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
