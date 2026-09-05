import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  TaxGetJobStatusParams,
  TaxJobStatusResponse,
} from '@/tools/oracle_epm_tax_reporting/types'
import { TAX_JOB_STATUS_OUTPUTS } from '@/tools/oracle_epm_tax_reporting/types'
import { taxAuthParams, taxFields, taxOAuth } from '@/tools/oracle_epm_tax_reporting/utils'
import type { InternalToolConfig } from '@/tools/types'

/** @see https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/retrieve_job_status.html */
export const oracleEpmTaxReportingGetJobStatusTool: InternalToolConfig<
  TaxGetJobStatusParams,
  TaxJobStatusResponse
> = {
  id: 'oracle_epm_tax_reporting_get_job_status',
  name: 'Oracle EPM Tax Reporting Get Job Status',
  description:
    'Inspect a submitted planning or supplemental job using its correct route family. Optionally wait without resubmitting.',
  version: '1.0.0',
  oauth: taxOAuth,
  params: {
    ...taxAuthParams,
    application: {
      ...taxFields.application,
      required: false,
      description:
        'Exact Tax Reporting application name. Required for planning (default) and supplemental_collection jobs; omit only for supplemental_dimension.',
    },
    jobId: taxFields.jobId,
    jobFamily: taxFields.jobFamily,
    waitForCompletion: taxFields.waitForCompletion,
  },
  operation: { input: createInternalToolOperationInput },
  outputs: TAX_JOB_STATUS_OUTPUTS,
}
