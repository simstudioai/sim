import { randomUUID } from 'crypto'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { createOnePasswordClient, resolveCredentials } from '../utils'

const logger = createLogger('OnePasswordResolveSecretAPI')

const ResolveSecretSchema = z.object({
  connectionMode: z.enum(['service_account', 'connect']).nullish(),
  serviceAccountToken: z.string().nullish(),
  serverUrl: z.string().nullish(),
  apiKey: z.string().nullish(),
  secretReference: z.string().min(1, 'Secret reference is required'),
})

export async function POST(request: NextRequest) {
  const requestId = randomUUID().slice(0, 8)

  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    logger.warn(`[${requestId}] Unauthorized 1Password resolve-secret attempt`)
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const params = ResolveSecretSchema.parse(body)
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
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }
    const message = error instanceof Error ? error.message : 'Unknown error'
    logger.error(`[${requestId}] Resolve secret failed:`, error)
    return NextResponse.json({ error: `Failed to resolve secret: ${message}` }, { status: 500 })
  }
}
