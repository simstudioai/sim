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

const logger = createLogger('OnePasswordUpdateItemAPI')

const UpdateItemSchema = z.object({
  connectionMode: z.enum(['service_account', 'connect']).nullish(),
  serviceAccountToken: z.string().nullish(),
  serverUrl: z.string().nullish(),
  apiKey: z.string().nullish(),
  vaultId: z.string().min(1, 'Vault ID is required'),
  itemId: z.string().min(1, 'Item ID is required'),
  operations: z.string().min(1, 'Patch operations are required'),
})

export async function POST(request: NextRequest) {
  const requestId = randomUUID().slice(0, 8)

  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    logger.warn(`[${requestId}] Unauthorized 1Password update-item attempt`)
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const params = UpdateItemSchema.parse(body)
    const creds = resolveCredentials(params)
    const ops = JSON.parse(params.operations) as JsonPatchOperation[]

    logger.info(
      `[${requestId}] Updating item ${params.itemId} in vault ${params.vaultId} (${creds.mode} mode)`
    )

    if (creds.mode === 'service_account') {
      const client = await createOnePasswordClient(creds.serviceAccountToken!)

      const item = await client.items.get(params.vaultId, params.itemId)

      for (const op of ops) {
        applyPatch(item, op)
      }

      const result = await client.items.put(item)
      return NextResponse.json(normalizeSdkItem(result))
    }

    const response = await connectRequest({
      serverUrl: creds.serverUrl!,
      apiKey: creds.apiKey!,
      path: `/v1/vaults/${params.vaultId}/items/${params.itemId}`,
      method: 'PATCH',
      body: ops,
    })

    const data = await response.json()
    if (!response.ok) {
      return NextResponse.json(
        { error: data.message || 'Failed to update item' },
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
    logger.error(`[${requestId}] Update item failed:`, error)
    return NextResponse.json({ error: `Failed to update item: ${message}` }, { status: 500 })
  }
}

interface JsonPatchOperation {
  op: 'add' | 'remove' | 'replace'
  path: string
  value?: unknown
}

/** Apply a single RFC6902 JSON Patch operation to a mutable object. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyPatch(item: Record<string, any>, op: JsonPatchOperation) {
  const segments = op.path.split('/').filter(Boolean)

  if (segments.length === 1) {
    const key = segments[0]
    if (op.op === 'replace' || op.op === 'add') {
      item[key] = op.value
    } else if (op.op === 'remove') {
      delete item[key]
    }
    return
  }

  let target = item
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]
    if (Array.isArray(target)) {
      target = target[Number(seg)]
    } else {
      target = target[seg]
    }
    if (target === undefined || target === null) return
  }

  const lastSeg = segments[segments.length - 1]

  if (op.op === 'replace' || op.op === 'add') {
    if (Array.isArray(target) && lastSeg === '-') {
      target.push(op.value)
    } else if (Array.isArray(target)) {
      target[Number(lastSeg)] = op.value
    } else {
      target[lastSeg] = op.value
    }
  } else if (op.op === 'remove') {
    if (Array.isArray(target)) {
      target.splice(Number(lastSeg), 1)
    } else {
      delete target[lastSeg]
    }
  }
}
