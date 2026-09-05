import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  TaxGetReportStatusParams,
  TaxReportResponse,
} from '@/tools/oracle_epm_tax_reporting/types'
import { TAX_REPORT_OUTPUTS } from '@/tools/oracle_epm_tax_reporting/types'
import { taxAuthParams, taxFields, taxOAuth } from '@/tools/oracle_epm_tax_reporting/utils'
import type { InternalToolConfig } from '@/tools/types'

/** @see https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/reports_retrieve_job_status_100x33699ee1.html */
export const oracleEpmTaxReportingGetReportStatusTool: InternalToolConfig<
  TaxGetReportStatusParams,
  TaxReportResponse
> = {
  id: 'oracle_epm_tax_reporting_get_report_status',
  name: 'Oracle EPM Tax Reporting Get Report Status',
  description:
    'Inspect a report job using the documented standalone route or the distinct route family returned by generation. Optionally download a completed report.',
  version: '1.0.0',
  oauth: taxOAuth,
  params: {
    ...taxAuthParams,
    jobId: taxFields.jobId,
    module: {
      ...taxFields.module,
      required: false,
      description:
        'FCCS (Task Manager) or SDM. Required for standalone (default) and generated_report status routes; omit only for user_details.',
    },
    reportStatusRoute: taxFields.reportStatusRoute,
    waitForCompletion: taxFields.waitForCompletion,
    downloadReport: taxFields.downloadReport,
  },
  operation: { input: createInternalToolOperationInput },
  outputs: TAX_REPORT_OUTPUTS,
}
