import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  NarrativeResponse,
  NarrativeToolParams,
} from '@/tools/oracle_epm_narrative_reporting/types'
import { narrativeAuthParams, narrativeOAuth } from '@/tools/oracle_epm_narrative_reporting/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmNarrativeReportingGetReportPackageTool: InternalToolConfig<
  NarrativeToolParams,
  NarrativeResponse
> = {
  id: 'oracle_epm_narrative_reporting_get_report_package',
  name: 'Oracle EPM Narrative Reporting Get Report Package',
  description: 'Read metadata for an existing report package by its native package ID.',
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
    reportPackage: {
      type: 'object',
      description:
        'Documented ReportPackage metadata; unknown fields and returned URLs are omitted',
      properties: {
        reportPackageId: {
          type: 'string',
          description: 'Native report package ID',
        },
        name: {
          type: 'string',
          description: 'Package name',
        },
        description: {
          type: 'string',
          description: 'description',
          nullable: true,
        },
        libraryPath: {
          type: 'string',
          description: 'libraryPath',
          nullable: true,
        },
        reportPackageType: {
          type: 'string',
          description: 'reportPackageType',
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
        modifiedBy: {
          type: 'string',
          description: 'modifiedBy',
          nullable: true,
        },
        modifiedDate: {
          type: 'string',
          description: 'modifiedDate',
          nullable: true,
        },
      },
    },
  },
}
