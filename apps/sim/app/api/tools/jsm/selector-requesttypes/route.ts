import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { jsmRequestTypesSelectorContract } from '@/lib/api/contracts/selectors/jsm'
import { parseRequest } from '@/lib/api/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { JsmOperationError } from '@/lib/internal/jsm/errors'
import { listJsmRequestTypeOptions } from '@/lib/internal/jsm/service-desk'
import { refreshAccessTokenIfNeeded } from '@/lib/oauth/credential-service'

const logger = createLogger('JsmSelectorRequestTypesAPI')

export const dynamic = 'force-dynamic'

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()
  try {
    const parsed = await parseRequest(jsmRequestTypesSelectorContract, request, {})
    if (!parsed.success) return parsed.response
    const { credential, workflowId, domain, serviceDeskId } = parsed.data.body
    const authz = await authorizeCredentialUse(request, { credentialId: credential, workflowId })
    if (!authz.ok || !authz.credentialOwnerUserId) {
      return NextResponse.json({ error: authz.error || 'Unauthorized' }, { status: 403 })
    }
    const accessToken = await refreshAccessTokenIfNeeded(
      credential,
      authz.credentialOwnerUserId,
      requestId
    )
    if (!accessToken) {
      return NextResponse.json(
        { error: 'Could not retrieve access token', authRequired: true },
        { status: 401 }
      )
    }
    const requestTypes = await listJsmRequestTypeOptions(
      { domain, accessToken, serviceDeskId },
      request.signal
    )
    return NextResponse.json({ requestTypes })
  } catch (error) {
    request.signal.throwIfAborted()
    logger.error('Error listing JSM request types:', error)
    return NextResponse.json(
      { error: getErrorMessage(error, 'Internal server error') },
      { status: error instanceof JsmOperationError ? error.status : 500 }
    )
  }
})
