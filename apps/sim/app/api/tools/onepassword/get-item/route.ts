import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { onePasswordGetItemContract } from '@/lib/api/contracts/tools/internal/onepassword'
import { parseRequest, validationErrorResponse } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  connectRequest,
  createOnePasswordClient,
  normalizeSdkItem,
  resolveCredentials,
} from '../utils'

const logger = createLogger('OnePasswordGetItemAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)

  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    logger.warn(`[${requestId}] Unauthorized 1Password get-item attempt`)
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseRequest(
      onePasswordGetItemContract,
      request,
      {},
      {
        validationErrorResponse: (error) => validationErrorResponse(error, 'Invalid request data'),
      }
    )
    if (!parsed.success) return parsed.response
    const params = parsed.data.body
    const creds = resolveCredentials(params)

    logger.info(
      `[${requestId}] Getting item ${params.itemId} from vault ${params.vaultId} (${creds.mode} mode)`
    )

    if (creds.mode === 'service_account') {
      const client = await createOnePasswordClient(creds.serviceAccountToken!)
      const item = await client.items.get(params.vaultId, params.itemId)
      return NextResponse.json(normalizeSdkItem(item))
    }

    const response = await connectRequest({
      serverUrl: creds.serverUrl!,
      apiKey: creds.apiKey!,
      path: `/v1/vaults/${params.vaultId}/items/${params.itemId}`,
      method: 'GET',
    })

    const data = await response.json()
    if (!response.ok) {
      return NextResponse.json(
        { error: data.message || 'Failed to get item' },
        { status: response.status }
      )
    }

    return NextResponse.json(data)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    logger.error(`[${requestId}] Get item failed:`, error)
    return NextResponse.json({ error: `Failed to get item: ${message}` }, { status: 500 })
  }
})
