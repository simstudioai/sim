import { isPlainRecord } from '@sim/utils/object'
import { ZodError } from 'zod'
import { ORACLE_FUSION_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/credentials/client-credential-accounts/descriptors'
import { OracleFusionProviderError } from '@/lib/internal/oracle-fusion/errors'
import { executeProcurementOperation } from '@/lib/internal/oracle-fusion-procurement/operations'
import {
  ProcurementInputError,
  ProcurementResponseError,
} from '@/lib/internal/oracle-fusion-procurement/schema'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'
import { resolveOAuthAccountId } from '@/lib/oauth/credential-service'

/** The executor authorizes credential use; this product boundary binds the credential family. */
export const executeOracleFusionProcurementTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  if (!isPlainRecord(request.input) || typeof request.input.oauthCredential !== 'string') {
    return Response.json(
      { success: false, output: {}, error: 'Invalid Procurement input' },
      { status: 400 }
    )
  }
  try {
    const account = await resolveOAuthAccountId(request.input.oauthCredential)
    if (
      account?.credentialType !== 'service_account' ||
      account.providerId !== ORACLE_FUSION_SERVICE_ACCOUNT_PROVIDER_ID
    ) {
      return Response.json(
        { success: false, output: {}, error: 'Oracle Fusion service-account credential is unavailable' },
        { status: 403 }
      )
    }
    const result = await executeProcurementOperation(request.toolId, request.input, request.signal)
    return Response.json(result)
  } catch (error) {
    request.signal?.throwIfAborted()
    const status =
      error instanceof OracleFusionProviderError
        ? error.status
        : error instanceof ZodError || error instanceof ProcurementInputError
          ? 400
          : error instanceof ProcurementResponseError
            ? 502
            : 500
    const message =
      error instanceof OracleFusionProviderError ||
      error instanceof ProcurementResponseError ||
      error instanceof ProcurementInputError
        ? error.message
        : error instanceof ZodError
          ? 'Invalid Oracle Fusion Procurement input; check the documented fields and exact ID strings'
          : 'Oracle Fusion Procurement request failed'
    return Response.json({ success: false, output: {}, error: message }, { status })
  }
}
