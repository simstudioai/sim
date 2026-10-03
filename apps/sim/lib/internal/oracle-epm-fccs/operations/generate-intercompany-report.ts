import { filterUndefined } from '@sim/utils/object'
import { z } from 'zod'
import { createFccsContext, parseFccsInput } from '@/lib/internal/oracle-epm-fccs/context'
import { submitFccsJob } from '@/lib/internal/oracle-epm-fccs/jobs'
import { fccsName } from '@/lib/internal/oracle-epm-fccs/schemas'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { FccsGenerateIntercompanyReportParams } from '@/tools/oracle_epm_fccs/types'

const inputSchema = z.object({
  application: fccsName,
  jobName: fccsName,
  scenario: fccsName.optional(),
  year: fccsName.optional(),
  period: fccsName.optional(),
  reportFormat: fccsName.optional(),
  fileName: fccsName.optional(),
})

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/fccs_generate_ic_report.html */
export const executeFccsGenerateIntercompanyReportOperation: InternalToolOperationImplementation<
  FccsGenerateIntercompanyReportParams
> = async (params, signal, context) => {
  const input = parseFccsInput(inputSchema, params)
  const ctx = createFccsContext(params, signal, context)
  const { application, jobName, year, ...parameters } = input
  return submitFccsJob(ctx, application, 'GENERATE_INTERCOMPANY_REPORT', jobName, {
    ...filterUndefined(parameters),
    ...(year === undefined ? {} : { years: year }),
  })
}
