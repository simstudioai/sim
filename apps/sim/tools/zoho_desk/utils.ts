import { htmlToText } from 'html-to-text'
import { isZohoHost } from '@/tools/zoho_desk/host-allowlist'
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
 * Derive a plain-text rendering of a Zoho Desk content value.
 *
 * Zoho is not consistent about how it spells the HTML discriminator: comment
 * bodies come back as `contentType: 'html'` while thread bodies use the MIME
 * form `contentType: 'text/html'`. A strict `=== 'html'` check therefore passes
 * thread HTML straight through as "plain text". Match either spelling (and any
 * other `text/html;charset=...` variant) case-insensitively.
 *
 * A plain-text (or unrecognized) content value is returned unchanged so callers
 * can mirror it into a parallel text field. Returns `undefined` when there is no
 * string content to derive from.
 */
export function deriveZohoContentText(content: unknown, contentType: unknown): string | undefined {
  if (typeof content !== 'string') return undefined
  if (typeof contentType !== 'string') return content
  const normalized = contentType.trim().toLowerCase()
  const isHtml = normalized === 'html' || normalized.startsWith('text/html')
  return isHtml ? convertZohoHtmlToText(content) : content
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
  const candidate = (params.apiDomain || DEFAULT_ZOHO_DESK_BASE).replace(/\/+$/, '')
  // Anchor to the Zoho apex allowlist before this host receives the OAuth token.
  // `apiDomain` is injected server-side from the credential and is hidden from
  // the LLM tool schema, but the injection in tools/index.ts lets a pre-existing
  // context value win over the credential-derived one - so validate rather than
  // trust precedence, and fall back to the US base on anything unrecognized.
  try {
    const url = new URL(candidate)
    if (url.protocol === 'https:' && isZohoHost(url.hostname)) return `${candidate}/api/v1`
  } catch {
    // fall through to the default base
  }
  return `${DEFAULT_ZOHO_DESK_BASE}/api/v1`
}

/**
 * Resolve an attachment `href` into an absolute download URL. Absolute hrefs are
 * used as-is; a relative href is resolved against the Desk API base (`apiBase`,
 * which ends in `/api/v1`). A leading slash and an already-present `api/v1/`
 * prefix are stripped first so a Zoho href like `/api/v1/tickets/1/.../content`
 * does not produce a duplicated `/api/v1/api/v1/...` path. Throws on an
 * unparseable result (the caller maps that to a 400).
 */
export function resolveZohoAttachmentUrl(href: string, apiBase: string): URL {
  if (/^https?:\/\//i.test(href)) return new URL(href)
  const path = href.replace(/^\/+/, '').replace(/^api\/v1\//i, '')
  return new URL(`${apiBase.replace(/\/+$/, '')}/${path}`)
}

/**
 * Trim an identifier destined for a URL path segment, rejecting a missing or
 * whitespace-only value. A pasted trailing space would otherwise be encoded as
 * `%20` and 404 against Zoho with no indication of the real cause.
 */
export function requireZohoDeskId(value: string | undefined, label: string): string {
  const trimmed = value?.trim()
  if (!trimmed) throw new Error(`${label} is required.`)
  return trimmed
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
  if (lastSegment?.includes('.') && lastSegment.toLowerCase() !== 'content') {
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
