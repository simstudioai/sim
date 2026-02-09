import { randomUUID } from 'crypto'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import {
  connectRequest,
  createOnePasswordClient,
  normalizeSdkItemOverview,
  resolveCredentials,
} from '../utils'

const logger = createLogger('OnePasswordListItemsAPI')

const ListItemsSchema = z.object({
  connectionMode: z.enum(['service_account', 'connect']).nullish(),
  serviceAccountToken: z.string().nullish(),
  serverUrl: z.string().nullish(),
  apiKey: z.string().nullish(),
  vaultId: z.string().min(1, 'Vault ID is required'),
  filter: z.string().nullish(),
})

export async function POST(request: NextRequest) {
  const requestId = randomUUID().slice(0, 8)

  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    logger.warn(`[${requestId}] Unauthorized 1Password list-items attempt`)
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const params = ListItemsSchema.parse(body)
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
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }
    const message = error instanceof Error ? error.message : 'Unknown error'
    logger.error(`[${requestId}] List items failed:`, error)
    return NextResponse.json({ error: `Failed to list items: ${message}` }, { status: 500 })
  }
}
