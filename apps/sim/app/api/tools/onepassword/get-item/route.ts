import { randomUUID } from 'crypto'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import {
  connectRequest,
  createOnePasswordClient,
  normalizeSdkItem,
  resolveCredentials,
} from '../utils'

const logger = createLogger('OnePasswordGetItemAPI')

const GetItemSchema = z.object({
  connectionMode: z.enum(['service_account', 'connect']).nullish(),
  serviceAccountToken: z.string().nullish(),
  serverUrl: z.string().nullish(),
  apiKey: z.string().nullish(),
  vaultId: z.string().min(1, 'Vault ID is required'),
  itemId: z.string().min(1, 'Item ID is required'),
})

export async function POST(request: NextRequest) {
  const requestId = randomUUID().slice(0, 8)

  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    logger.warn(`[${requestId}] Unauthorized 1Password get-item attempt`)
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const params = GetItemSchema.parse(body)
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
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }
    const message = error instanceof Error ? error.message : 'Unknown error'
    logger.error(`[${requestId}] Get item failed:`, error)
    return NextResponse.json({ error: `Failed to get item: ${message}` }, { status: 500 })
  }
}
