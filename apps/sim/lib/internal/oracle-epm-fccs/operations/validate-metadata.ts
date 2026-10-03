import { z } from 'zod'
import {
  createFccsContext,
  fccsResult,
  parseFccsInput,
  projectFccsResponse,
} from '@/lib/internal/oracle-epm-fccs/context'
import { fccsEndpoints } from '@/lib/internal/oracle-epm-fccs/endpoints'
import { fccsMetadataValidationSchema, fccsName } from '@/lib/internal/oracle-epm-fccs/schemas'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { FccsValidateMetadataParams } from '@/tools/oracle_epm_fccs/types'

const inputSchema = z.object({
  application: fccsName,
  logFileName: fccsName.optional(),
})

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/fccs_validate_metadata.html */
export const executeFccsValidateMetadataOperation: InternalToolOperationImplementation<
  FccsValidateMetadataParams
> = async (params, signal, context) => {
  const input = parseFccsInput(inputSchema, params)
  const ctx = createFccsContext(params, signal, context)
  return fccsResult(
    projectFccsResponse(
      fccsMetadataValidationSchema,
      await ctx.client.request(fccsEndpoints.validateMetadata, {
        pathParams: { application: input.application },
        query: { logFileName: input.logFileName },
        signal,
      })
    )
  )
}
