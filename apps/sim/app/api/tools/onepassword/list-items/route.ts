import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { onePasswordListItemsContract } from '@/lib/api/contracts/tools/onepassword'
import { parseRequest, validationErrorResponse } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  connectRequest,
  createOnePasswordClient,
  normalizeSdkItemOverview,
  resolveCredentials,
} from '../utils'

const logger = createLogger('OnePasswordListItemsAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)

  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    logger.warn(`[${requestId}] Unauthorized 1Password list-items attempt`)
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseRequest(
      onePasswordListItemsContract,
      request,
      {},
      {
        validationErrorResponse: (error) => validationErrorResponse(error, 'Invalid request data'),
      }
    )
    if (!parsed.success) return parsed.response
    const params = parsed.data.body
    const creds = resolveCredentials(params)

    logger.info(`[${requestId}] Listing items in vault ${params.vaultId} (${creds.mode} mode)`)

    if (creds.mode === 'service_account') {
      const client = await createOnePasswordClient(creds.serviceAccountToken!)
      const items = await client.items.list(params.vaultId)
      const normalized = items.map(normalizeSdkItemOverview)

      if (params.filter) {
        const filterLower = params.filter.toLowerCase()
        const filtered = normalized.filter(
          (item) =>
            item.title?.toLowerCase().includes(filterLower) ||
            item.id?.toLowerCase().includes(filterLower)
        )
        return NextResponse.json(filtered)
      }

      return NextResponse.json(normalized)
    }

    const query = params.filter ? `filter=${encodeURIComponent(params.filter)}` : undefined
    const response = await connectRequest({
      serverUrl: creds.serverUrl!,
      apiKey: creds.apiKey!,
      path: `/v1/vaults/${params.vaultId}/items`,
      method: 'GET',
      query,
    })

    const data = await response.json()
    if (!response.ok) {
      return NextResponse.json(
        { error: data.message || 'Failed to list items' },
        { status: response.status }
      )
    }

    return NextResponse.json(data)
  } catch (error) {
    const message = getErrorMessage(error, 'Unknown error')
    logger.error(`[${requestId}] List items failed:`, error)
    return NextResponse.json({ error: `Failed to list items: ${message}` }, { status: 500 })
  }
})
