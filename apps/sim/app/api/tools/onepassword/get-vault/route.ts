import { randomUUID } from 'crypto'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import {
  connectRequest,
  createOnePasswordClient,
  normalizeSdkVault,
  resolveCredentials,
} from '../utils'

const logger = createLogger('OnePasswordGetVaultAPI')

const GetVaultSchema = z.object({
  connectionMode: z.enum(['service_account', 'connect']).nullish(),
  serviceAccountToken: z.string().nullish(),
  serverUrl: z.string().nullish(),
  apiKey: z.string().nullish(),
  vaultId: z.string().min(1, 'Vault ID is required'),
})

export async function POST(request: NextRequest) {
  const requestId = randomUUID().slice(0, 8)

  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    logger.warn(`[${requestId}] Unauthorized 1Password get-vault attempt`)
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const params = GetVaultSchema.parse(body)
    const creds = resolveCredentials(params)

    logger.info(`[${requestId}] Getting 1Password vault ${params.vaultId} (${creds.mode} mode)`)

    if (creds.mode === 'service_account') {
      const client = await createOnePasswordClient(creds.serviceAccountToken!)
      const vaults = await client.vaults.list()
      const vault = vaults.find((v) => v.id === params.vaultId)

      if (!vault) {
        return NextResponse.json({ error: 'Vault not found' }, { status: 404 })
      }

      return NextResponse.json(normalizeSdkVault(vault))
    }

    const response = await connectRequest({
      serverUrl: creds.serverUrl!,
      apiKey: creds.apiKey!,
      path: `/v1/vaults/${params.vaultId}`,
      method: 'GET',
    })

    const data = await response.json()
    if (!response.ok) {
      return NextResponse.json(
        { error: data.message || 'Failed to get vault' },
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
    logger.error(`[${requestId}] Get vault failed:`, error)
    return NextResponse.json({ error: `Failed to get vault: ${message}` }, { status: 500 })
  }
}
