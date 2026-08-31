import { secureFetchWithValidation } from '@/lib/core/security/input-validation.server'
import { ZohoDeskOperationError } from '@/lib/internal/zoho-desk/errors'
import { isZohoHost } from '@/tools/zoho_desk/host-allowlist'
import type { ZohoDeskGetAttachmentParams } from '@/tools/zoho_desk/types'
import {
  buildZohoDeskHeaders,
  deriveAttachmentName,
  getZohoDeskApiBase,
  resolveZohoAttachmentUrl,
} from '@/tools/zoho_desk/utils'

export const MAX_ZOHO_DESK_ATTACHMENT_BYTES = 7 * 1024 * 1024

export interface ZohoDeskOperationContext {
  signal?: AbortSignal
}

export async function getZohoDeskAttachment(
  input: ZohoDeskGetAttachmentParams,
  context: ZohoDeskOperationContext
): Promise<{
  success: true
  output: { file: { data: string; mimeType: string; name: string } }
}> {
  context.signal?.throwIfAborted()
  let downloadUrl: URL
  try {
    downloadUrl = resolveZohoAttachmentUrl(
      input.href,
      getZohoDeskApiBase({ apiDomain: input.apiDomain })
    )
  } catch {
    throw new ZohoDeskOperationError('Invalid attachment href', 400)
  }
  if (downloadUrl.protocol !== 'https:' || !isZohoHost(downloadUrl.hostname)) {
    throw new ZohoDeskOperationError('Attachment href must be an https Zoho URL', 400)
  }

  const response = await secureFetchWithValidation(downloadUrl.toString(), {
    profile: 'contentFetch',
    method: 'GET',
    headers: buildZohoDeskHeaders({ accessToken: input.accessToken, orgId: input.orgId }),
    timeout: 30_000,
    maxResponseBytes: MAX_ZOHO_DESK_ATTACHMENT_BYTES,
    stripAuthOnRedirect: true,
    signal: context.signal,
  })
  if (!response.ok) {
    throw new ZohoDeskOperationError(
      `Failed to download attachment (HTTP ${response.status})`,
      response.status >= 400 && response.status < 500 ? response.status : 502
    )
  }
  if (response.status !== 200) {
    throw new ZohoDeskOperationError(
      `Attachment returned no content (HTTP ${response.status})`,
      502
    )
  }
  const buffer = Buffer.from(await response.arrayBuffer())
  context.signal?.throwIfAborted()
  return {
    success: true,
    output: {
      file: {
        data: buffer.toString('base64'),
        mimeType: response.headers.get('content-type') || 'application/octet-stream',
        name: deriveAttachmentName(
          input.fileName,
          response.headers.get('content-disposition'),
          downloadUrl.pathname
        ),
      },
    },
  }
}
