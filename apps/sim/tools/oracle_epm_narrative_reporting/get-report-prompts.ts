import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  NarrativeResponse,
  NarrativeToolParams,
} from '@/tools/oracle_epm_narrative_reporting/types'
import { narrativeAuthParams, narrativeOAuth } from '@/tools/oracle_epm_narrative_reporting/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmNarrativeReportingGetReportPromptsTool: InternalToolConfig<
  NarrativeToolParams,
  NarrativeResponse
> = {
  id: 'oracle_epm_narrative_reporting_get_report_prompts',
  name: 'Oracle EPM Narrative Reporting Get Report Prompts',
  description: 'Read native prompt IDs and valid selections for report rendering.',
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
    prompts: {
      type: 'array',
      description: 'Documented prompts',
      items: {
        type: 'object',
        properties: {
          promptId: {
            type: 'string',
            description: 'promptId',
            nullable: true,
          },
          label: {
            type: 'string',
            description: 'label',
            nullable: true,
          },
          dimensionName: {
            type: 'string',
            description: 'dimensionName',
            nullable: true,
          },
          sourceElement: {
            type: 'string',
            description: 'sourceElement',
            nullable: true,
          },
          sourceType: {
            type: 'string',
            description: 'sourceType',
            nullable: true,
          },
          allowMultipleSelections: {
            type: 'boolean',
            description: 'Whether multiple selections are allowed',
            nullable: true,
          },
          suggestedMembers: {
            type: 'array',
            description: 'Suggested members',
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
          defaultSelection: {
            type: 'array',
            description: 'Default members',
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
