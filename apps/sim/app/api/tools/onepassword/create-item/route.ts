import { randomUUID } from 'crypto'
import type { ItemCreateParams } from '@1password/sdk'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import {
  connectRequest,
  createOnePasswordClient,
  normalizeSdkItem,
  resolveCredentials,
  toSdkCategory,
  toSdkFieldType,
} from '../utils'

const logger = createLogger('OnePasswordCreateItemAPI')

const CreateItemSchema = z.object({
  connectionMode: z.enum(['service_account', 'connect']).nullish(),
  serviceAccountToken: z.string().nullish(),
  serverUrl: z.string().nullish(),
  apiKey: z.string().nullish(),
  vaultId: z.string().min(1, 'Vault ID is required'),
  category: z.string().min(1, 'Category is required'),
  title: z.string().nullish(),
  tags: z.string().nullish(),
  fields: z.string().nullish(),
})

export async function POST(request: NextRequest) {
  const requestId = randomUUID().slice(0, 8)

  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    logger.warn(`[${requestId}] Unauthorized 1Password create-item attempt`)
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const params = CreateItemSchema.parse(body)
    const creds = resolveCredentials(params)

    logger.info(`[${requestId}] Creating item in vault ${params.vaultId} (${creds.mode} mode)`)

    if (creds.mode === 'service_account') {
      const client = await createOnePasswordClient(creds.serviceAccountToken!)

      const parsedTags = params.tags
        ? params.tags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean)
        : undefined

      const parsedFields = params.fields
        ? (JSON.parse(params.fields) as Array<Record<string, any>>).map((f) => ({
            id: f.id || randomUUID().slice(0, 8),
            title: f.label || f.title || '',
            fieldType: toSdkFieldType(f.type || 'STRING'),
            value: f.value || '',
            sectionId: f.section?.id ?? f.sectionId,
          }))
        : undefined

      const item = await client.items.create({
        vaultId: params.vaultId,
        category: toSdkCategory(params.category),
        title: params.title || '',
        tags: parsedTags,
        fields: parsedFields,
      } as ItemCreateParams)

      return NextResponse.json(normalizeSdkItem(item))
    }

    const connectBody: Record<string, unknown> = {
      vault: { id: params.vaultId },
      category: params.category,
    }
    if (params.title) connectBody.title = params.title
    if (params.tags) connectBody.tags = params.tags.split(',').map((t) => t.trim())
    if (params.fields) connectBody.fields = JSON.parse(params.fields)

    const response = await connectRequest({
      serverUrl: creds.serverUrl!,
      apiKey: creds.apiKey!,
      path: `/v1/vaults/${params.vaultId}/items`,
      method: 'POST',
      body: connectBody,
    })

    const data = await response.json()
    if (!response.ok) {
      return NextResponse.json(
        { error: data.message || 'Failed to create item' },
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
    logger.error(`[${requestId}] Create item failed:`, error)
    return NextResponse.json({ error: `Failed to create item: ${message}` }, { status: 500 })
  }
}
