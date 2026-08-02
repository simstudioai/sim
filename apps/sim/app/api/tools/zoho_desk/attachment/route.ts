import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { zohoDeskGetAttachmentContract } from '@/lib/api/contracts/tools/zoho-desk'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { secureFetchWithValidation } from '@/lib/core/security/input-validation.server'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { isZohoHost } from '@/tools/zoho_desk/host-allowlist'
import {
  buildZohoDeskHeaders,
  deriveAttachmentName,
  getZohoDeskApiBase,
  resolveZohoAttachmentUrl,
} from '@/tools/zoho_desk/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('ZohoDeskAttachmentAPI')

/**
 * Ceiling on a downloaded attachment.
 *
 * This route returns the file base64-encoded inside its JSON body, and the
 * executor reads an internal tool response through `readToolResponseBody`, which
 * caps at `MAX_TOOL_RESPONSE_BODY_BYTES` (10 MB). Base64 inflates by 4/3, so the
 * largest attachment that can actually survive the round trip is ~7.5 MB of raw
 * bytes. A larger ceiling here is not merely useless - it is actively harmful:
 * the route would download, encode, and serialize the whole file (peaking around
 * 250 MB of live allocation for a 50 MB attachment, with nothing limiting
 * concurrent downloads) only for the executor to reject the oversized body
 * afterwards. Capping at the reachable size makes the transport limit enforce
 * itself early, while the bytes are still being streamed.
 *
 * Raising this requires uploading in the route and returning a file reference
 * instead of inline base64, the way the WhatsApp media and Typeform file routes
 * do - not a bigger number here.
 */
const MAX_ATTACHMENT_BYTES = 7 * 1024 * 1024

export const POST = withRouteHandler(async (request: NextRequest) => {
  const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
  if (!authResult.success) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = await parseRequest(zohoDeskGetAttachmentContract, request, {})
  if (!parsed.success) return parsed.response
  const { accessToken, apiDomain, orgId, href, fileName } = parsed.data.body

  let downloadUrl: URL
  try {
    downloadUrl = resolveZohoAttachmentUrl(
      href,
      getZohoDeskApiBase({ apiDomain: apiDomain ?? undefined })
    )
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid attachment href' }, { status: 400 })
  }

  if (downloadUrl.protocol !== 'https:' || !isZohoHost(downloadUrl.hostname)) {
    return NextResponse.json(
      { success: false, error: 'Attachment href must be an https Zoho URL' },
      { status: 400 }
    )
  }

  try {
    // Even though the initial host is allowlisted, the download URL is
    // user/LLM-influenced and Zoho may redirect. secureFetchWithValidation pins
    // the resolved IP, blocks private/reserved targets on every hop, and
    // (stripAuthOnRedirect) drops the OAuth token if a redirect leaves the
    // original origin, so the credential never reaches an untrusted host.
    // maxResponseBytes enforces the size cap while streaming.
    const response = await secureFetchWithValidation(downloadUrl.toString(), {
      method: 'GET',
      headers: buildZohoDeskHeaders({ accessToken, orgId }),
      timeout: 30_000,
      maxResponseBytes: MAX_ATTACHMENT_BYTES,
      stripAuthOnRedirect: true,
    })

    if (!response.ok) {
      logger.warn('Failed to download Zoho Desk attachment', { status: response.status })
      return NextResponse.json(
        { success: false, error: `Failed to download attachment (HTTP ${response.status})` },
        { status: response.status >= 400 && response.status < 500 ? response.status : 502 }
      )
    }

    // A 204 (or any non-200 success) carries no body, so arrayBuffer() would
    // yield zero bytes and the route would report success with an empty file.
    if (response.status !== 200) {
      return NextResponse.json(
        { success: false, error: `Attachment returned no content (HTTP ${response.status})` },
        { status: 502 }
      )
    }

    const arrayBuffer = await response.arrayBuffer()

    // ToolFileData (consumed by FileToolProcessor) keys the file name as `name`.
    const name = deriveAttachmentName(
      fileName,
      response.headers.get('content-disposition'),
      downloadUrl.pathname
    )
    const mimeType = response.headers.get('content-type') || 'application/octet-stream'

    return NextResponse.json({
      success: true,
      output: {
        file: {
          data: Buffer.from(arrayBuffer).toString('base64'),
          mimeType,
          name,
        },
      },
    })
  } catch (error) {
    // An oversized attachment is a client-visible limit, not a server fault -
    // surface it as 413 with the actual ceiling, mirroring the WhatsApp media
    // route, instead of collapsing it into a generic 500.
    if (isPayloadSizeLimitError(error)) {
      logger.warn('Zoho Desk attachment exceeds the download limit', {
        maxBytes: MAX_ATTACHMENT_BYTES,
      })
      return NextResponse.json(
        {
          success: false,
          error: `Attachment exceeds the ${Math.floor(MAX_ATTACHMENT_BYTES / (1024 * 1024))} MB download limit`,
        },
        { status: 413 }
      )
    }
    logger.error('Error downloading Zoho Desk attachment', { error: getErrorMessage(error) })
    return NextResponse.json(
      { success: false, error: getErrorMessage(error, 'Failed to download attachment') },
      { status: 500 }
    )
  }
})
