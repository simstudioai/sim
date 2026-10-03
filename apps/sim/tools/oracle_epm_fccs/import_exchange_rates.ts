import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { FccsImportExchangeRatesParams, FccsResponse } from '@/tools/oracle_epm_fccs/types'
import { FCCS_JOB_OUTPUTS } from '@/tools/oracle_epm_fccs/types'
import { fccsAuthParams, fccsParamFields } from '@/tools/oracle_epm_fccs/utils'
import type { InternalToolConfig } from '@/tools/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/pbcs_import_exchange_rates.html */
export const oracleEpmFccsImportExchangeRatesTool: InternalToolConfig<
  FccsImportExchangeRatesParams,
  FccsResponse
> = {
  id: 'oracle_epm_fccs_import_exchange_rates',
  name: 'Oracle EPM FCCS Import Exchange Rates',
  description: 'Submit a saved exchange-rate import job with optional file and metadata overrides.',
  version: '1.0.0',
  params: {
    ...fccsAuthParams,
    application: fccsParamFields.application,
    jobName: fccsParamFields.jobName,
    parameters: { ...fccsParamFields.parameters, required: false },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: FCCS_JOB_OUTPUTS,
}
