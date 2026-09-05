import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  NarrativeResponse,
  NarrativeToolParams,
} from '@/tools/oracle_epm_narrative_reporting/types'
import { narrativeAuthParams, narrativeOAuth } from '@/tools/oracle_epm_narrative_reporting/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmNarrativeReportingImportLibraryArtifactTool: InternalToolConfig<
  NarrativeToolParams,
  NarrativeResponse
> = {
  id: 'oracle_epm_narrative_reporting_import_library_artifact',
  name: 'Oracle EPM Narrative Reporting Import Library Artifact',
  description:
    'Submit an import job from an existing provider file. Completion requires a separate wait.',
  version: '1.0.0',
  oauth: narrativeOAuth,
  params: {
    ...narrativeAuthParams,
    ...{
      importFile: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Existing provider-side import file ID or path.',
      },
      importLocation: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Import source: Temporary, Library, or File.',
      },
      importFormat: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Import format: Native (default) or File.',
      },
      importFolder: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Optional library destination folder.',
      },
      deleteAfterImport: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Delete the provider import file after import. Default false.',
      },
      importPermissions: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Import permissions from the archive. Default false.',
      },
      overwrite: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Whether to overwrite an existing artifact. Default false.',
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
