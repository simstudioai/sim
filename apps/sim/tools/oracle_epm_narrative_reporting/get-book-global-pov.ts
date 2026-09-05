import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  NarrativeResponse,
  NarrativeToolParams,
} from '@/tools/oracle_epm_narrative_reporting/types'
import { narrativeAuthParams, narrativeOAuth } from '@/tools/oracle_epm_narrative_reporting/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmNarrativeReportingGetBookGlobalPovTool: InternalToolConfig<
  NarrativeToolParams,
  NarrativeResponse
> = {
  id: 'oracle_epm_narrative_reporting_get_book_global_pov',
  name: 'Oracle EPM Narrative Reporting Get Book Global POV',
  description: 'Read the book’s global point-of-view dimensions and suggested members.',
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
    dimensions: {
      type: 'array',
      description: 'Documented dimensions',
      items: {
        type: 'object',
        properties: {
          dimensionId: {
            type: 'string',
            description: 'Dimension ID',
            nullable: true,
          },
          name: {
            type: 'string',
            description: 'Dimension name',
            nullable: true,
          },
          hidden: {
            type: 'boolean',
            description: 'Hidden dimension',
            nullable: true,
          },
          fixedSelection: {
            type: 'boolean',
            description: 'Fixed selection',
            nullable: true,
          },
          suggestedMembers: {
            type: 'array',
            description: 'Suggested members, up to 1,000',
            items: {
              type: 'object',
              properties: {
                memberId: {
                  type: 'string',
                  description: 'memberId',
                  nullable: true,
                },
                name: {
                  type: 'string',
                  description: 'name',
                  nullable: true,
                },
                alias: {
                  type: 'string',
                  description: 'alias',
                  nullable: true,
                },
              },
            },
          },
        },
      },
    },
  },
}
