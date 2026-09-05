import { z } from 'zod'
import { createFccsContext, parseFccsInput } from '@/lib/internal/oracle-epm-fccs/context'
import { submitFccsJob } from '@/lib/internal/oracle-epm-fccs/jobs'
import { fccsName, fccsParameters } from '@/lib/internal/oracle-epm-fccs/schemas'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { FccsImportExchangeRatesParams } from '@/tools/oracle_epm_fccs/types'

const inputSchema = z.object({
  application: fccsName,
  jobName: fccsName,
  parameters: fccsParameters.optional(),
})

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/pbcs_import_exchange_rates.html */
export const executeFccsImportExchangeRatesOperation: InternalToolOperationImplementation<
  FccsImportExchangeRatesParams
> = async (params, signal, context) => {
  const input = parseFccsInput(inputSchema, params)
  const ctx = createFccsContext(params, signal, context)
  return submitFccsJob(
    ctx,
    input.application,
    'IMPORT_EXCHANGE_RATES',
    input.jobName,
    input.parameters
  )
}
