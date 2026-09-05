import { isPlainRecord } from '@sim/utils/object'
import { ZodError } from 'zod'
import { ORACLE_FUSION_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/credentials/client-credential-accounts/descriptors'
import { OracleFusionProviderError } from '@/lib/internal/oracle-fusion/errors'
import { executeRiskOperation } from '@/lib/internal/oracle-fusion-risk-management/operations'
import {
  RiskInputError,
  RiskResponseError,
} from '@/lib/internal/oracle-fusion-risk-management/schema'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'
import { resolveOAuthAccountId } from '@/lib/oauth/credential-service'

/** The executor authorizes credential use; this product boundary binds the credential family. */
export const executeOracleFusionRiskManagementTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  if (!isPlainRecord(request.input) || typeof request.input.oauthCredential !== 'string') {
    return Response.json(
      { success: false, output: {}, error: 'Invalid Risk Management input' },
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
        {
          success: false,
          output: {},
          error: 'Oracle Fusion service-account credential is unavailable',
        },
        { status: 403 }
      )
    }
    const result = await executeRiskOperation(request.toolId, request.input, request.signal)
    return Response.json(result)
  } catch (error) {
    request.signal?.throwIfAborted()
    const status =
      error instanceof OracleFusionProviderError
        ? error.status
        : error instanceof ZodError || error instanceof RiskInputError
          ? 400
          : error instanceof RiskResponseError
            ? 502
            : 500
    const message =
      error instanceof OracleFusionProviderError ||
      error instanceof RiskResponseError ||
      error instanceof RiskInputError
        ? error.message
        : error instanceof ZodError
          ? 'Invalid Oracle Fusion Risk Management input; check the documented fields and exact ID strings'
          : 'Oracle Fusion Risk Management request failed'
    return Response.json({ success: false, output: {}, error: message }, { status })
  }
}
