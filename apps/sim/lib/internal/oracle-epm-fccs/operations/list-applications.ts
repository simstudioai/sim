import {
  createFccsContext,
  fccsResult,
  projectFccsResponse,
} from '@/lib/internal/oracle-epm-fccs/context'
import { fccsEndpoints } from '@/lib/internal/oracle-epm-fccs/endpoints'
import { fccsApplicationsSchema } from '@/lib/internal/oracle-epm-fccs/schemas'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { FccsListApplicationsParams } from '@/tools/oracle_epm_fccs/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/get_applications.html */
export const executeFccsListApplicationsOperation: InternalToolOperationImplementation<
  FccsListApplicationsParams
> = async (params, signal, context) => {
  const ctx = createFccsContext(params, signal, context)
  const output = projectFccsResponse(
    fccsApplicationsSchema,
    await ctx.client.request(fccsEndpoints.listApplications, { signal })
  )
  return fccsResult(output)
}
