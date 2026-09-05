import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  NarrativeResponse,
  NarrativeToolParams,
} from '@/tools/oracle_epm_narrative_reporting/types'
import { narrativeAuthParams, narrativeOAuth } from '@/tools/oracle_epm_narrative_reporting/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmNarrativeReportingListBooksTool: InternalToolConfig<
  NarrativeToolParams,
  NarrativeResponse
> = {
  id: 'oracle_epm_narrative_reporting_list_books',
  name: 'Oracle EPM Narrative Reporting List Books',
  description: 'List one bounded page of native Narrative Reporting books.',
  version: '1.0.0',
  oauth: narrativeOAuth,
  params: {
    ...narrativeAuthParams,
    ...{
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
    books: {
      type: 'array',
      description: 'Documented books',
      items: {
        type: 'object',
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
          primaryDatasource: {
            type: 'string',
            description: 'primaryDatasource',
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
            description: 'Validation messages',
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
