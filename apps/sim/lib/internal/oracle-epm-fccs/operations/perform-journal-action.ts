import { filterUndefined } from '@sim/utils/object'
import { z } from 'zod'
import {
  createFccsContext,
  parseFccsInput,
  projectFccsResponse,
} from '@/lib/internal/oracle-epm-fccs/context'
import { fccsEndpoints } from '@/lib/internal/oracle-epm-fccs/endpoints'
import { fccsJournalActionSchema, fccsName } from '@/lib/internal/oracle-epm-fccs/schemas'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { FccsPerformJournalActionParams } from '@/tools/oracle_epm_fccs/types'

const inputSchema = z.object({
  application: fccsName,
  journalLabel: fccsName,
  scenario: fccsName,
  year: fccsName,
  period: fccsName,
  journalAction: z.enum(['SUBMIT', 'APPROVE', 'POST', 'UNPOST', 'REJECT']),
  consolidation: fccsName.optional(),
})

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/fccs_perform_journal_actions.html */
export const executeFccsPerformJournalActionOperation: InternalToolOperationImplementation<
  FccsPerformJournalActionParams
> = async (params, signal, context) => {
  const input = parseFccsInput(inputSchema, params)
  const ctx = createFccsContext(params, signal, context)
  const { application, journalLabel, journalAction: action, ...pov } = input
  const output = projectFccsResponse(
    fccsJournalActionSchema,
    await ctx.client.request(fccsEndpoints.performJournalAction, {
      pathParams: { application, journalLabel },
      json: { parameters: { ...filterUndefined(pov), action } },
      signal,
    })
  )
  return {
    success: output.actionStatus === 0,
    output,
    ...(output.actionStatus === 0 ? {} : { error: 'Oracle EPM FCCS rejected the journal action' }),
  }
}
