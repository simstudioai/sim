import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  TaxDeployFormTemplatesParams,
  TaxSupplementalResponse,
} from '@/tools/oracle_epm_tax_reporting/types'
import { TAX_SUPPLEMENTAL_OUTPUTS } from '@/tools/oracle_epm_tax_reporting/types'
import { taxAuthParams, taxFields, taxOAuth } from '@/tools/oracle_epm_tax_reporting/utils'
import type { InternalToolConfig } from '@/tools/types'

/** @see https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/fccs_deploy_form_templates.html */
export const oracleEpmTaxReportingDeployFormTemplatesTool: InternalToolConfig<
  TaxDeployFormTemplatesParams,
  TaxSupplementalResponse
> = {
  id: 'oracle_epm_tax_reporting_deploy_form_templates',
  name: 'Oracle EPM Tax Reporting Deploy Form Templates',
  description:
    'Deploy Supplemental Data templates for a collection interval. Empty templates deploys all; resetWorkflows resets existing workflows. Requires Service Administrator or Power User.',
  version: '1.0.0',
  oauth: taxOAuth,
  params: {
    ...taxAuthParams,
    application: taxFields.application,
    collectionIntervalName: taxFields.collectionIntervalName,
    templates: taxFields.templates,
    frequencyDimensions: taxFields.frequencyDimensions,
    resetWorkflows: taxFields.resetWorkflows,
    jobName: { ...taxFields.jobName, required: false },
    waitForCompletion: taxFields.waitForCompletion,
  },
  operation: { input: createInternalToolOperationInput },
  outputs: TAX_SUPPLEMENTAL_OUTPUTS,
}
