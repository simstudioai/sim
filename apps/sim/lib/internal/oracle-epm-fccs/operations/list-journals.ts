import { z } from 'zod'
import {
  createFccsContext,
  fccsResult,
  parseFccsInput,
  projectFccsResponse,
} from '@/lib/internal/oracle-epm-fccs/context'
import { fccsEndpoints } from '@/lib/internal/oracle-epm-fccs/endpoints'
import { fccsJournalsSchema, fccsName, fccsPageInput } from '@/lib/internal/oracle-epm-fccs/schemas'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { FccsListJournalsParams } from '@/tools/oracle_epm_fccs/types'

const inputSchema = z.object({
  application: fccsName,
  scenario: fccsName,
  year: fccsName,
  period: fccsName,
  journalStatus: z.enum(['WORKING', 'SUBMITTED', 'POSTED', 'APPROVED']),
  consolidation: fccsName.optional(),
  group: fccsName.optional(),
  journalLabel: fccsName.optional(),
  description: fccsName.optional(),
  entity: fccsName.optional(),
  offset: fccsPageInput.offset,
  limit: fccsPageInput.limit,
})

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/fccs_retrieve_journals.html */
export const executeFccsListJournalsOperation: InternalToolOperationImplementation<
  FccsListJournalsParams
> = async (params, signal, context) => {
  const input = parseFccsInput(inputSchema, params)
  const ctx = createFccsContext(params, signal, context)
  const {
    application,
    journalStatus: status,
    journalLabel: label,
    offset,
    limit,
    ...filters
  } = input
  return fccsResult(
    projectFccsResponse(
      fccsJournalsSchema,
      await ctx.client.request(fccsEndpoints.listJournals, {
        pathParams: { application },
        query: { q: JSON.stringify({ ...filters, status, label }), offset, limit },
        signal,
      })
    )
  )
}
