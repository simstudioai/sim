import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { onePasswordGetItemFileContract } from '@/lib/api/contracts/tools/onepassword'
import { parseRequest, validationErrorResponse } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  connectRequest,
  createOnePasswordClient,
  findItemFileAttributes,
  resolveCredentials,
} from '../utils'

const logger = createLogger('OnePasswordGetItemFileAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)

  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    logger.warn(`[${requestId}] Unauthorized 1Password get-item-file attempt`)
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseRequest(
      onePasswordGetItemFileContract,
      request,
      {},
      {
        validationErrorResponse: (error) => validationErrorResponse(error, 'Invalid request data'),
      }
    )
    if (!parsed.success) return parsed.response
    const params = parsed.data.body
    const creds = resolveCredentials(params)

    logger.info(
      `[${requestId}] Downloading file ${params.fileId} from item ${params.itemId} (${creds.mode} mode)`
    )

    if (creds.mode === 'service_account') {
      const client = await createOnePasswordClient(creds.serviceAccountToken!)
      const item = await client.items.get(params.vaultId, params.itemId)
      const attr = findItemFileAttributes(item, params.fileId)
      if (!attr) {
        return NextResponse.json({ error: 'File not found on item' }, { status: 404 })
      }

      const content = await client.items.files.read(params.vaultId, params.itemId, attr)
      return NextResponse.json({
        file: {
          name: attr.name,
          mimeType: 'application/octet-stream',
          data: Buffer.from(content).toString('base64'),
          size: attr.size,
        },
      })
    }

    const metaResponse = await connectRequest({
      serverUrl: creds.serverUrl!,
      apiKey: creds.apiKey!,
      path: `/v1/vaults/${params.vaultId}/items/${params.itemId}/files/${params.fileId}`,
      method: 'GET',
    })
    if (!metaResponse.ok) {
      const metaData = await metaResponse.json().catch(() => ({}))
      return NextResponse.json(
        { error: metaData.message || 'Failed to get file metadata' },
        { status: metaResponse.status }
      )
    }
    const meta = await metaResponse.json()

    const contentResponse = await connectRequest({
      serverUrl: creds.serverUrl!,
      apiKey: creds.apiKey!,
      path: `/v1/vaults/${params.vaultId}/items/${params.itemId}/files/${params.fileId}/content`,
      method: 'GET',
    })
    if (!contentResponse.ok) {
      const errorData = await contentResponse.json().catch(() => ({}))
      return NextResponse.json(
        { error: errorData.message || 'Failed to download file content' },
        { status: contentResponse.status }
      )
    }

    const buffer = Buffer.from(await contentResponse.arrayBuffer())
    return NextResponse.json({
      file: {
        name: meta.name ?? 'attachment',
        mimeType: contentResponse.headers.get('content-type') || 'application/octet-stream',
        data: buffer.toString('base64'),
        size: meta.size ?? buffer.length,
      },
    })
  } catch (error) {
    const message = getErrorMessage(error, 'Unknown error')
    logger.error(`[${requestId}] Get item file failed:`, error)
    return NextResponse.json({ error: `Failed to get item file: ${message}` }, { status: 500 })
  }
})
