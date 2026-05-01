import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { onePasswordResolveSecretContract } from '@/lib/api/contracts/tools/internal/onepassword'
import { parseRequest, validationErrorResponse } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createOnePasswordClient, resolveCredentials } from '../utils'

const logger = createLogger('OnePasswordResolveSecretAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)

  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    logger.warn(`[${requestId}] Unauthorized 1Password resolve-secret attempt`)
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseRequest(
      onePasswordResolveSecretContract,
      request,
      {},
      {
        validationErrorResponse: (error) => validationErrorResponse(error, 'Invalid request data'),
      }
    )
    if (!parsed.success) return parsed.response
    const params = parsed.data.body
    const creds = resolveCredentials(params)

    if (creds.mode !== 'service_account') {
      return NextResponse.json(
        { error: 'Resolve Secret is only available in Service Account mode' },
        { status: 400 }
      )
    }

    logger.info(`[${requestId}] Resolving secret reference (service_account mode)`)

    const client = await createOnePasswordClient(creds.serviceAccountToken!)
    const secret = await client.secrets.resolve(params.secretReference)

    return NextResponse.json({
      value: secret,
      reference: params.secretReference,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    logger.error(`[${requestId}] Resolve secret failed:`, error)
    return NextResponse.json({ error: `Failed to resolve secret: ${message}` }, { status: 500 })
  }
})
