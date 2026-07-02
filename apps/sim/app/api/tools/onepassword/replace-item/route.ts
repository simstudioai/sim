import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { onePasswordReplaceItemContract } from '@/lib/api/contracts/tools/onepassword'
import { parseRequest, validationErrorResponse } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  connectItemToSdkItem,
  connectRequest,
  createOnePasswordClient,
  normalizeSdkItem,
  resolveCredentials,
} from '../utils'

const logger = createLogger('OnePasswordReplaceItemAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)

  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    logger.warn(`[${requestId}] Unauthorized 1Password replace-item attempt`)
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseRequest(
      onePasswordReplaceItemContract,
      request,
      {},
      {
        validationErrorResponse: (error) => validationErrorResponse(error, 'Invalid request data'),
      }
    )
    if (!parsed.success) return parsed.response
    const params = parsed.data.body
    const creds = resolveCredentials(params)
    const itemData = JSON.parse(params.item)

    logger.info(
      `[${requestId}] Replacing item ${params.itemId} in vault ${params.vaultId} (${creds.mode} mode)`
    )

    if (creds.mode === 'service_account') {
      const client = await createOnePasswordClient(creds.serviceAccountToken!)

      const existing = await client.items.get(params.vaultId, params.itemId)
      const sdkItem = connectItemToSdkItem(itemData, existing)
      const result = await client.items.put(sdkItem)
      return NextResponse.json(normalizeSdkItem(result))
    }

    const response = await connectRequest({
      serverUrl: creds.serverUrl!,
      apiKey: creds.apiKey!,
      path: `/v1/vaults/${params.vaultId}/items/${params.itemId}`,
      method: 'PUT',
      body: itemData,
    })

    const data = await response.json()
    if (!response.ok) {
      return NextResponse.json(
        { error: data.message || 'Failed to replace item' },
        { status: response.status }
      )
    }

    return NextResponse.json(data)
  } catch (error) {
    const message = getErrorMessage(error, 'Unknown error')
    logger.error(`[${requestId}] Replace item failed:`, error)
    return NextResponse.json({ error: `Failed to replace item: ${message}` }, { status: 500 })
  }
})
