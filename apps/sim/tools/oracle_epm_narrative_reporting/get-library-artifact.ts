import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  NarrativeResponse,
  NarrativeToolParams,
} from '@/tools/oracle_epm_narrative_reporting/types'
import { narrativeAuthParams, narrativeOAuth } from '@/tools/oracle_epm_narrative_reporting/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmNarrativeReportingGetLibraryArtifactTool: InternalToolConfig<
  NarrativeToolParams,
  NarrativeResponse
> = {
  id: 'oracle_epm_narrative_reporting_get_library_artifact',
  name: 'Oracle EPM Narrative Reporting Get Library Artifact',
  description: 'Read repository artifact metadata by its repository ID.',
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
    artifact: {
      type: 'object',
      description: 'Documented Artifact metadata; unknown fields and returned URLs are omitted',
      properties: {
        artifactId: {
          type: 'string',
          description: 'Repository artifact ID; not interchangeable with a report or package ID',
        },
        name: {
          type: 'string',
          description: 'Artifact name',
        },
        description: {
          type: 'string',
          description: 'description',
          nullable: true,
        },
        type: {
          type: 'string',
          description: 'type',
          nullable: true,
        },
        typeID: {
          type: 'string',
          description: 'typeID',
          nullable: true,
        },
        pathName: {
          type: 'string',
          description: 'pathName',
          nullable: true,
        },
        modifiedBy: {
          type: 'string',
          description: 'modifiedBy',
          nullable: true,
        },
        favorite: {
          type: 'boolean',
          description: 'Favorite flag',
          nullable: true,
        },
        ordinal: {
          type: 'number',
          description: 'Ordinal',
          nullable: true,
        },
        createdBy: {
          type: 'string',
          description: 'createdBy',
          nullable: true,
        },
        creationDate: {
          type: 'string',
          description: 'creationDate',
          nullable: true,
        },
        modifiedDate: {
          type: 'string',
          description: 'modifiedDate',
          nullable: true,
        },
        lastAccessed: {
          type: 'string',
          description: 'lastAccessed',
          nullable: true,
        },
      },
    },
  },
}
