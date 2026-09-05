import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  NarrativeResponse,
  NarrativeToolParams,
} from '@/tools/oracle_epm_narrative_reporting/types'
import { narrativeAuthParams, narrativeOAuth } from '@/tools/oracle_epm_narrative_reporting/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmNarrativeReportingGetBookTool: InternalToolConfig<
  NarrativeToolParams,
  NarrativeResponse
> = {
  id: 'oracle_epm_narrative_reporting_get_book',
  name: 'Oracle EPM Narrative Reporting Get Book',
  description: 'Read native book metadata.',
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
    book: {
      type: 'object',
      description: 'Documented Book metadata; unknown fields and returned URLs are omitted',
      properties: {
        bookId: {
          type: 'string',
          description: 'Native book ID',
        },
        name: {
          type: 'string',
          description: 'Book name',
        },
        description: {
          type: 'string',
          description: 'description',
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
        datasourceNames: {
          type: 'array',
          description: 'Data source names',
          items: {
            type: 'string',
          },
        },
        validationMessages: {
          type: 'array',
          nullable: true,
          description:
            'Validation messages; null when Oracle does not return validation information',
          items: {
            type: 'string',
          },
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
