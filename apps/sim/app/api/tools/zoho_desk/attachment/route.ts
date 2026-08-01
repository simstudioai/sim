import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { zohoDeskGetAttachmentContract } from '@/lib/api/contracts/tools/zoho-desk'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { secureFetchWithValidation } from '@/lib/core/security/input-validation.server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  buildZohoDeskHeaders,
  deriveAttachmentName,
  getZohoDeskApiBase,
} from '@/tools/zoho_desk/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('ZohoDeskAttachmentAPI')

const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024

/**
 * Zoho-owned apex domains across data centers. The `href` on an attachment is
 * user/LLM-influenced, so the download host must be anchored to one of these
 * with a strict suffix match — a naive `contains "zoho."` check would accept an
 * attacker domain like `zoho.attacker.com` or `desk.zoho.com.attacker.com` and
 * leak the OAuth token + orgId to it.
 */
const ZOHO_ALLOWED_APEX_DOMAINS = [
  'zoho.com',
  'zoho.eu',
  'zoho.in',
  'zoho.com.au',
  'zoho.jp',
  'zoho.ca',
  'zoho.sa',
  'zoho.com.cn',
  'zoho.uk',
  'zohoapis.com',
  'zohoapis.eu',
  'zohoapis.in',
  'zohoapis.com.au',
  'zohoapis.jp',
  'zohoapis.ca',
  'zohoapis.sa',
  'zohoapis.com.cn',
  'zohoapis.uk',
]

/** True only when the hostname is exactly a Zoho apex or a subdomain of one. */
function isZohoHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return ZOHO_ALLOWED_APEX_DOMAINS.some((apex) => host === apex || host.endsWith(`.${apex}`))
}

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
    downloadUrl = href.startsWith('http')
      ? new URL(href)
      : new URL(
          `${getZohoDeskApiBase({ apiDomain: apiDomain ?? undefined })}/${href.replace(/^\/+/, '')}`
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
    logger.error('Error downloading Zoho Desk attachment', { error: getErrorMessage(error) })
    return NextResponse.json(
      { success: false, error: getErrorMessage(error, 'Failed to download attachment') },
      { status: 500 }
    )
  }
})
