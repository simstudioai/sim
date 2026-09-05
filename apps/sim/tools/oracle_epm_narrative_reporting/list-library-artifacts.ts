import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  NarrativeResponse,
  NarrativeToolParams,
} from '@/tools/oracle_epm_narrative_reporting/types'
import { narrativeAuthParams, narrativeOAuth } from '@/tools/oracle_epm_narrative_reporting/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmNarrativeReportingListLibraryArtifactsTool: InternalToolConfig<
  NarrativeToolParams,
  NarrativeResponse
> = {
  id: 'oracle_epm_narrative_reporting_list_library_artifacts',
  name: 'Oracle EPM Narrative Reporting List Library Artifacts',
  description: 'List one bounded page of repository artifacts or a folder’s children.',
  version: '1.0.0',
  oauth: narrativeOAuth,
  params: {
    ...narrativeAuthParams,
    ...{
      folderId: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Optional repository folder UUID. Omit to list the library collection.',
      },
      limit: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Maximum objects on one page (1–100, default 50).',
      },
      offset: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Zero-based page offset (0–1,000,000, default 0).',
      },
      q: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Oracle SCIM filter expression, for example name co "Budget".',
      },
      orderBy: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Comma-separated field:asc or field:desc sort terms supported by this collection.',
      },
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    artifacts: {
      type: 'array',
      description: 'Documented artifacts',
      items: {
        type: 'object',
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
          typeLabel: {
            type: 'string',
            description: 'typeLabel',
            nullable: true,
          },
          pathName: {
            type: 'string',
            description: 'pathName',
            nullable: true,
          },
          systemPath: {
            type: 'string',
            description: 'systemPath',
            nullable: true,
          },
          mimeType: {
            type: 'string',
            description: 'mimeType',
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
    offset: {
      type: 'number',
      description: 'Provider page offset, when returned',
      optional: true,
    },
    limit: {
      type: 'number',
      description: 'Provider page limit, when returned',
      optional: true,
    },
    count: {
      type: 'number',
      description: 'Provider page count, when returned',
      optional: true,
    },
    hasMore: {
      type: 'boolean',
      description: 'Whether another page exists, when returned',
      optional: true,
    },
    totalResults: {
      type: 'number',
      description: 'Provider total, when returned',
      optional: true,
    },
  },
}
