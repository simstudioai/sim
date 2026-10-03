import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  TaxGenerateReportParams,
  TaxReportJobResponse,
} from '@/tools/oracle_epm_tax_reporting/types'
import { TAX_REPORT_JOB_OUTPUTS } from '@/tools/oracle_epm_tax_reporting/types'
import { taxAuthParams, taxFields, taxOAuth } from '@/tools/oracle_epm_tax_reporting/utils'
import type { InternalToolConfig } from '@/tools/types'

/** @see https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/fccstrcs_rest_generate_reports.html */
export const oracleEpmTaxReportingGenerateReportTool: InternalToolConfig<
  TaxGenerateReportParams,
  TaxReportJobResponse
> = {
  id: 'oracle_epm_tax_reporting_generate_report',
  name: 'Oracle EPM Tax Reporting Generate Report',
  description:
    'Generate a Task Manager or Supplemental Data report asynchronously. Requires the feature and report access. Existing output files may be overwritten.',
  version: '1.0.0',
  oauth: taxOAuth,
  params: {
    ...taxAuthParams,
    groupName: taxFields.groupName,
    reportName: taxFields.reportName,
    generatedReportFileName: taxFields.generatedReportFileName,
    parameters: taxFields.parameters,
    format: { ...taxFields.format, description: 'HTML, PDF (default), XLSX, or CSV.' },
    module: taxFields.module,
    waitForCompletion: taxFields.waitForCompletion,
  },
  operation: { input: createInternalToolOperationInput },
  outputs: TAX_REPORT_JOB_OUTPUTS,
}
