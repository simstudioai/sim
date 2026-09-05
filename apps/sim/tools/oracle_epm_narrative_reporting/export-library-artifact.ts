import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  NarrativeResponse,
  NarrativeToolParams,
} from '@/tools/oracle_epm_narrative_reporting/types'
import { narrativeAuthParams, narrativeOAuth } from '@/tools/oracle_epm_narrative_reporting/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmNarrativeReportingExportLibraryArtifactTool: InternalToolConfig<
  NarrativeToolParams,
  NarrativeResponse
> = {
  id: 'oracle_epm_narrative_reporting_export_library_artifact',
  name: 'Oracle EPM Narrative Reporting Export Library Artifact',
  description:
    'Submit an artifact export job; completion requires a separate wait. Automatic Temporary-export downloading is not supported.',
  version: '1.0.0',
  oauth: narrativeOAuth,
  params: {
    ...narrativeAuthParams,
    ...{
      artifactName: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Library artifact name or path to export.',
      },
      artifactType: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Oracle resource type, for example ReportResourceType or BookResourceType.',
      },
      exportLocation: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Export destination: Temporary (default), Library, or File. Temporary result links are not automatically downloaded.',
      },
      exportFormat: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Native (default), File, or LCM. LCM requires applicationName and supports reports only.',
      },
      exportLibraryFolder: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Library export destination folder when exportLocation is Library.',
      },
      saveAsFile: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Optional provider-side export filename.',
      },
      applicationName: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Application name, required for an LCM report export.',
      },
      errorFile: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Optional provider-side error filename.',
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
