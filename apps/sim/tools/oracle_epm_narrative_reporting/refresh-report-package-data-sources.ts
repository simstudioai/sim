import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  NarrativeResponse,
  NarrativeToolParams,
} from '@/tools/oracle_epm_narrative_reporting/types'
import { narrativeAuthParams, narrativeOAuth } from '@/tools/oracle_epm_narrative_reporting/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmNarrativeReportingRefreshReportPackageDataSourcesTool: InternalToolConfig<
  NarrativeToolParams,
  NarrativeResponse
> = {
  id: 'oracle_epm_narrative_reporting_refresh_package_data_sources',
  name: 'Oracle EPM Narrative Reporting Refresh Package Data Sources',
  description:
    'Submit a package data source refresh job by package name. This does not publish the package.',
  version: '1.0.0',
  oauth: narrativeOAuth,
  params: {
    ...narrativeAuthParams,
    ...{
      reportPackageName: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Report package name or library path, NOT its UUID.',
      },
      refreshableSources: {
        type: 'array',
        required: false,
        visibility: 'user-or-llm',
        description: 'Optional data sources to refresh; omit for the provider default.',
        items: {
          type: 'string',
          maxLength: 255,
        },
        maxItems: 100,
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
