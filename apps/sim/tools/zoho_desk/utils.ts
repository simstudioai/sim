import { htmlToText } from 'html-to-text'
import { DEFAULT_ZOHO_DESK_BASE, isZohoHost } from '@/tools/zoho_desk/host-allowlist'
import type { ZohoDeskBaseParams } from '@/tools/zoho_desk/types'

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
 * True when a string carries HTML markup worth stripping - an element tag or a
 * character entity. Used where Zoho gives no content-type discriminator, so a
 * genuinely plain body is never run through html-to-text (which would decode
 * entities and delete tag-shaped text that was never markup).
 */
function looksLikeHtml(value: string): boolean {
  // Requires a real element - a paired <tag>...</tag>, a self-closing <tag/>, or
  // an HTML comment/doctype. A bare `<`...`>` pair is NOT enough: plain support
  // text like "if x<y then z>0" or "replace <username> with the real name" would
  // otherwise be run through html-to-text and silently lose everything between
  // the brackets. Entity form covers named, decimal and hex references.
  return (
    /<([a-z][a-z0-9]*)\b[^>]*>[\s\S]*<\/\1\s*>/i.test(value) ||
    /<[a-z][a-z0-9]*\b[^>]*\/>/i.test(value) ||
    /<!(?:--|doctype)/i.test(value) ||
    /&(?:[a-z]+|#\d+|#x[0-9a-f]+);/i.test(value)
  )
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
  // Ticket resources carry their body on `description`, not `content`, and Zoho
  // ships NO content-type discriminator for it: the Ticket_Add webhook sample
  // has `"description": "<div>Description</div>"` with no `descriptionContentType`
  // key, and the ticket GET/PATCH field lists have no content-type sibling.
  //
  // But the shape is not consistently HTML either - Zoho's own REST samples show
  // plain descriptions ("Hi. There is a sudden delay in the processing of the
  // orders."), and the webhook path runs this over contact/account/department
  // payloads whose `description` Zoho documents as plain text. Converting
  // unconditionally is therefore lossy on the plain case: html-to-text decodes
  // entities (`&amp;` -> `&`) and deletes anything tag-shaped (`a < b > c`, an
  // XML snippet). Sniff for markup instead and pass anything without it through
  // untouched, so neither shape is mangled. An explicit descriptionContentType
  // still wins if Zoho ever starts sending one.
  const descriptionText =
    typeof record.description === 'string'
      ? typeof record.descriptionContentType === 'string'
        ? deriveZohoContentText(record.description, record.descriptionContentType)
        : looksLikeHtml(record.description)
          ? convertZohoHtmlToText(record.description)
          : record.description
      : undefined

  if (contentText === undefined && descriptionText === undefined) return record
  return {
    ...record,
    ...(contentText !== undefined ? { contentText } : {}),
    ...(descriptionText !== undefined ? { descriptionText } : {}),
  }
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
 * Normalize a comma-separated Zoho query value to the bare `a,b` form Zoho's
 * samples use. A pasted or LLM-written `accounts, owner` would otherwise reach
 * Zoho as `accounts,+owner`; Zoho does not document whether it tolerates the
 * separator space, so strip it rather than find out in production. Only the
 * padding around each entry is removed, so multi-word values like `On Hold`
 * survive intact. Returns `undefined` when nothing usable remains, so the
 * caller omits the param entirely.
 */
export function normalizeZohoDeskCommaList(value: unknown): string | undefined {
  // Accepts an array as well as a string: a multi-select subBlock stores its
  // value as one, and an emptied picker stores `[]`. Calling `.split` on that
  // would throw and take the whole run down.
  const entries = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : undefined
  if (!entries) return undefined
  const normalized = entries
    .map((entry) => String(entry).trim())
    .filter(Boolean)
    .join(',')
  return normalized || undefined
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

/**
 * Summarize the per-field entries Zoho attaches to a validation failure. Zoho
 * documents the array form as `{"fieldName": "/contactId", "errorType": "invalid"}`;
 * `errorMessage` is also accepted because other Desk surfaces carry a prose
 * message under that key. Without this, every `INVALID_DATA` reads as the
 * useless "The data does not comply to the validation restrictions defined."
 * with no field named. A non-array `errors` value is ignored.
 */
function summarizeZohoDeskFieldErrors(errors: unknown): string {
  if (!Array.isArray(errors)) return ''
  const parts = errors
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return undefined
      const { fieldName, errorType, errorMessage } = entry as Record<string, unknown>
      const detail =
        typeof errorMessage === 'string' && errorMessage.trim()
          ? errorMessage
          : typeof errorType === 'string' && errorType.trim()
            ? errorType
            : undefined
      if (!detail) return undefined
      return typeof fieldName === 'string' && fieldName.trim() ? `${fieldName}: ${detail}` : detail
    })
    .filter((part): part is string => Boolean(part))
  return parts.length > 0 ? ` (${parts.join('; ')})` : ''
}

/** Extract a human-readable error message from a Zoho Desk error response body. */
export function getZohoDeskErrorMessage(data: unknown, fallback: string): string {
  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>
    const fieldErrors = summarizeZohoDeskFieldErrors(record.errors)
    if (typeof record.message === 'string' && record.message.trim()) {
      return `${record.message}${fieldErrors}`
    }
    if (typeof record.errorCode === 'string' && record.errorCode.trim()) {
      return `${record.errorCode}${fieldErrors}`
    }
  }
  return fallback
}
