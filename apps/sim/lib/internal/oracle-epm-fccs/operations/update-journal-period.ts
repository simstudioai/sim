import { z } from 'zod'
import {
  createFccsContext,
  parseFccsInput,
  projectFccsResponse,
} from '@/lib/internal/oracle-epm-fccs/context'
import { fccsEndpoints } from '@/lib/internal/oracle-epm-fccs/endpoints'
import { fccsJournalPeriodSchema, fccsName } from '@/lib/internal/oracle-epm-fccs/schemas'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { FccsUpdateJournalPeriodParams } from '@/tools/oracle_epm_fccs/types'

const inputSchema = z.object({
  application: fccsName,
  scenario: fccsName,
  year: fccsName,
  period: fccsName,
  periodAction: z.enum(['OPEN', 'CLOSE']),
})

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/fccs_perform_journal_update.html */
export const executeFccsUpdateJournalPeriodOperation: InternalToolOperationImplementation<
  FccsUpdateJournalPeriodParams
> = async (params, signal, context) => {
  const input = parseFccsInput(inputSchema, params)
  const ctx = createFccsContext(params, signal, context)
  const { application, period, periodAction: action, scenario, year } = input
  const response = projectFccsResponse(
    fccsJournalPeriodSchema,
    await ctx.client.request(fccsEndpoints.updateJournalPeriod, {
      pathParams: { application, period },
      json: { parameters: { scenario, year, action } },
      signal,
    })
  )
  const output = { scenario, year, period, action, ...('actionStatus' in response ? response : {}) }
  if (
    !('actionStatus' in response) &&
    (response.scenario !== scenario ||
      response.year !== year ||
      response.period !== period ||
      response.action.toUpperCase() !== action)
  )
    throw new Error('Oracle EPM FCCS returned a different journal period')
  return {
    success: !('actionStatus' in response) || response.actionStatus === 0,
    output,
    ...('actionStatus' in response && response.actionStatus !== 0
      ? { error: 'Oracle EPM FCCS rejected the journal period action' }
      : {}),
  }
}
