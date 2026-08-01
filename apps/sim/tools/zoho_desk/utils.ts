import { htmlToText } from 'html-to-text'
import type { ZohoDeskBaseParams } from '@/tools/zoho_desk/types'

/** Default Zoho Desk REST host when no data-center-specific base was persisted. */
const DEFAULT_ZOHO_DESK_BASE = 'https://desk.zoho.com'

/**
 * Convert Zoho Desk rich-text HTML (comment / thread / ticket bodies) to
 * readable plain text. Mirrors the per-integration `html-to-text` configuration
 * used elsewhere in the codebase (Outlook, Gmail, Confluence): anchors collapse
 * to their text, and img / script / style subtrees are dropped. Configured
 * locally because each integration's markup differs; there is no shared helper.
 */
export function convertZohoHtmlToText(html: string): string {
  if (!html) return ''
  return htmlToText(html, {
    wordwrap: false,
    selectors: [
      { selector: 'a', options: { hideLinkHrefIfSameAsText: true, noAnchorUrl: true } },
      { selector: 'img', format: 'skip' },
      { selector: 'script', format: 'skip' },
      { selector: 'style', format: 'skip' },
    ],
    preserveNewlines: true,
  })
}

/**
 * Derive a plain-text rendering of a Zoho Desk content value. Zoho tags every
 * content body with a `contentType` discriminator (`'html' | 'plainText'`); only
 * `'html'` is converted. A plain-text (or unrecognized) content value is
 * returned unchanged so callers can mirror it into a parallel text field. Returns
 * `undefined` when there is no string content to derive from.
 */
export function deriveZohoContentText(content: unknown, contentType: unknown): string | undefined {
  if (typeof content !== 'string') return undefined
  return contentType === 'html' ? convertZohoHtmlToText(content) : content
}

/**
 * Return a shallow copy of a Zoho Desk resource (comment / thread / event
 * payload) augmented with a derived `contentText` field alongside the raw
 * `content` + `contentType`. The raw HTML is never mutated or replaced - some
 * consumers want the markup. Resources without a string `content` (or a
 * non-object value) are returned unchanged.
 */
export function withDerivedContentText(resource: unknown): unknown {
  if (!resource || typeof resource !== 'object' || Array.isArray(resource)) return resource
  const record = resource as Record<string, unknown>
  const contentText = deriveZohoContentText(record.content, record.contentType)
  if (contentText === undefined) return record
  return { ...record, contentText }
}

/**
 * Resolve the Zoho Desk REST API base (`{deskBase}/api/v1`). `apiDomain` is the
 * data-center-scoped Desk base persisted from the OAuth token response, so calls
 * always reach the correct data center instead of assuming `desk.zoho.com`.
 */
export function getZohoDeskApiBase(params: Pick<ZohoDeskBaseParams, 'apiDomain'>): string {
  const base = (params.apiDomain || DEFAULT_ZOHO_DESK_BASE).replace(/\/+$/, '')
  return `${base}/api/v1`
}

/** Build the auth + org headers required on every Zoho Desk API call. */
export function buildZohoDeskHeaders(
  params: Pick<ZohoDeskBaseParams, 'accessToken' | 'orgId'>
): Record<string, string> {
  if (!params.accessToken) throw new Error('Zoho Desk access token is required')
  if (!params.orgId) throw new Error('Zoho Desk organization ID is required')
  return {
    Authorization: `Zoho-oauthtoken ${params.accessToken}`,
    orgId: String(params.orgId),
    'Content-Type': 'application/json',
  }
}

/**
 * Derive a sensible name for a downloaded attachment so files aren't all stored
 * as a generic default: an explicit override wins, else the Content-Disposition
 * filename, else the last path segment of the download URL when it looks like a
 * real file name (has an extension and isn't a generic `.../content` endpoint),
 * else a plain fallback.
 */
export function deriveAttachmentName(
  explicit: string | null | undefined,
  contentDisposition: string | null | undefined,
  pathname: string
): string {
  const trimmedExplicit = explicit?.trim()
  if (trimmedExplicit) return trimmedExplicit

  const dispositionMatch = contentDisposition
    ? /filename\*?=(?:UTF-8'')?["']?([^"';]+)/i.exec(contentDisposition)?.[1]
    : undefined
  if (dispositionMatch) {
    try {
      return decodeURIComponent(dispositionMatch)
    } catch {
      return dispositionMatch
    }
  }

  let lastSegment = ''
  try {
    lastSegment = decodeURIComponent(pathname.split('/').filter(Boolean).pop() ?? '')
  } catch {
    lastSegment = pathname.split('/').filter(Boolean).pop() ?? ''
  }
  if (lastSegment && lastSegment.includes('.') && lastSegment.toLowerCase() !== 'content') {
    return lastSegment
  }

  return 'attachment'
}

/** Extract a human-readable error message from a Zoho Desk error response body. */
export function getZohoDeskErrorMessage(data: unknown, fallback: string): string {
  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>
    if (typeof record.message === 'string' && record.message.trim()) return record.message
    if (typeof record.errorCode === 'string' && record.errorCode.trim()) return record.errorCode
  }
  return fallback
}
