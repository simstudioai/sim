import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  NarrativeResponse,
  NarrativeToolParams,
} from '@/tools/oracle_epm_narrative_reporting/types'
import { narrativeAuthParams, narrativeOAuth } from '@/tools/oracle_epm_narrative_reporting/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmNarrativeReportingWaitForJobTool: InternalToolConfig<
  NarrativeToolParams,
  NarrativeResponse
> = {
  id: 'oracle_epm_narrative_reporting_wait_for_job',
  name: 'Oracle EPM Narrative Reporting Wait for Job',
  description:
    'Poll an existing job within a bounded wait. Preserve its ID on timeout; never resubmit the operation.',
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
      maxWaitSeconds: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Maximum wait in seconds (10–240, default 120). A local timeout does not cancel the Oracle job.',
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
      nullable: true,
    },
    jobId: {
      type: 'string',
      description: 'Oracle job ID, including on timeout',
    },
    completed: {
      type: 'boolean',
      description: 'True only when Oracle reports success',
    },
    timedOut: {
      type: 'boolean',
      description: 'Local wait timed out; Oracle job was not cancelled',
    },
    attempts: {
      type: 'number',
      description: 'Number of status reads',
    },
  },
}
