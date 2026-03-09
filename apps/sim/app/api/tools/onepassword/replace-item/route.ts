import { randomUUID } from 'crypto'
import type { Item } from '@1password/sdk'
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

const logger = createLogger('OnePasswordReplaceItemAPI')

const ReplaceItemSchema = z.object({
  connectionMode: z.enum(['service_account', 'connect']).nullish(),
  serviceAccountToken: z.string().nullish(),
  serverUrl: z.string().nullish(),
  apiKey: z.string().nullish(),
  vaultId: z.string().min(1, 'Vault ID is required'),
  itemId: z.string().min(1, 'Item ID is required'),
  item: z.string().min(1, 'Item JSON is required'),
})

export async function POST(request: NextRequest) {
  const requestId = randomUUID().slice(0, 8)

  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    logger.warn(`[${requestId}] Unauthorized 1Password replace-item attempt`)
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const params = ReplaceItemSchema.parse(body)
    const creds = resolveCredentials(params)
    const itemData = JSON.parse(params.item)

    logger.info(
      `[${requestId}] Replacing item ${params.itemId} in vault ${params.vaultId} (${creds.mode} mode)`
    )

    if (creds.mode === 'service_account') {
      const client = await createOnePasswordClient(creds.serviceAccountToken!)

      const existing = await client.items.get(params.vaultId, params.itemId)

      const sdkItem = {
        ...existing,
        id: params.itemId,
        title: itemData.title || existing.title,
        category: itemData.category ? toSdkCategory(itemData.category) : existing.category,
        vaultId: params.vaultId,
        fields: itemData.fields
          ? (itemData.fields as Array<Record<string, any>>).map((f) => ({
              id: f.id || randomUUID().slice(0, 8),
              title: f.label || f.title || '',
              fieldType: toSdkFieldType(f.type || 'STRING'),
              value: f.value || '',
              sectionId: f.section?.id ?? f.sectionId,
            }))
          : existing.fields,
        sections: itemData.sections
          ? (itemData.sections as Array<Record<string, any>>).map((s) => ({
              id: s.id || '',
              title: s.label || s.title || '',
            }))
          : existing.sections,
        notes: itemData.notes ?? existing.notes,
        tags: itemData.tags ?? existing.tags,
        websites:
          itemData.urls || itemData.websites
            ? (itemData.urls ?? itemData.websites ?? []).map((u: Record<string, any>) => ({
                url: u.href || u.url || '',
                label: u.label || '',
                autofillBehavior: 'AnywhereOnWebsite' as const,
              }))
            : existing.websites,
      } as Item

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
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }
    const message = error instanceof Error ? error.message : 'Unknown error'
    logger.error(`[${requestId}] Replace item failed:`, error)
    return NextResponse.json({ error: `Failed to replace item: ${message}` }, { status: 500 })
  }
}
