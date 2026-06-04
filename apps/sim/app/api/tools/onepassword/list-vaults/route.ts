import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { onePasswordListVaultsContract } from '@/lib/api/contracts/tools/onepassword'
import { parseRequest, validationErrorResponse } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  connectRequest,
  createOnePasswordClient,
  normalizeSdkVault,
  resolveCredentials,
} from '../utils'

const logger = createLogger('OnePasswordListVaultsAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)

  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    logger.warn(`[${requestId}] Unauthorized 1Password list-vaults attempt`)
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseRequest(
      onePasswordListVaultsContract,
      request,
      {},
      {
        validationErrorResponse: (error) => validationErrorResponse(error, 'Invalid request data'),
      }
    )
    if (!parsed.success) return parsed.response
    const params = parsed.data.body
    const creds = resolveCredentials(params)

    logger.info(`[${requestId}] Listing 1Password vaults (${creds.mode} mode)`)

    if (creds.mode === 'service_account') {
      const client = await createOnePasswordClient(creds.serviceAccountToken!)
      const vaults = await client.vaults.list()
      const normalized = vaults.map(normalizeSdkVault)

      if (params.filter) {
        const filterLower = params.filter.toLowerCase()
        const filtered = normalized.filter(
          (v) =>
            v.name?.toLowerCase().includes(filterLower) || v.id?.toLowerCase().includes(filterLower)
        )
        return NextResponse.json(filtered)
      }

      return NextResponse.json(normalized)
    }

    const query = params.filter ? `filter=${encodeURIComponent(params.filter)}` : undefined
    const response = await connectRequest({
      serverUrl: creds.serverUrl!,
      apiKey: creds.apiKey!,
      path: '/v1/vaults',
      method: 'GET',
      query,
    })

    const data = await response.json()
    if (!response.ok) {
      return NextResponse.json(
        { error: data.message || 'Failed to list vaults' },
        { status: response.status }
      )
    }

    return NextResponse.json(data)
  } catch (error) {
    const message = getErrorMessage(error, 'Unknown error')
    logger.error(`[${requestId}] List vaults failed:`, error)
    return NextResponse.json({ error: `Failed to list vaults: ${message}` }, { status: 500 })
  }
})
