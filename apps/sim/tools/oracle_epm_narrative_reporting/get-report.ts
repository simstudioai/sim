import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  NarrativeResponse,
  NarrativeToolParams,
} from '@/tools/oracle_epm_narrative_reporting/types'
import { narrativeAuthParams, narrativeOAuth } from '@/tools/oracle_epm_narrative_reporting/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmNarrativeReportingGetReportTool: InternalToolConfig<
  NarrativeToolParams,
  NarrativeResponse
> = {
  id: 'oracle_epm_narrative_reporting_get_report',
  name: 'Oracle EPM Narrative Reporting Get Report',
  description: 'Read native report metadata.',
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
    report: {
      type: 'object',
      description: 'Documented Report metadata; unknown fields and returned URLs are omitted',
      properties: {
        reportId: {
          type: 'string',
          description: 'Native report or report snapshot ID',
        },
        name: {
          type: 'string',
          description: 'Report name',
        },
        description: {
          type: 'string',
          description: 'Report description',
          nullable: true,
        },
        instanceType: {
          type: 'string',
          description: 'editor, result, or snapshot when returned',
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
        invalidFields: {
          type: 'array',
          description: 'Invalid fields',
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
