import { normalizeAtlassianSiteUrl, resolveAtlassianCloudId } from '@/lib/atlassian/discovery'
import type { RetryOptions } from '@/lib/knowledge/documents/utils'

const SITE_URL_SCHEME = 'https://'

/**
 * Strips protocol and trailing slashes and lowercases a Confluence domain to
 * produce a bare host (e.g. `yoursite.atlassian.net`).
 *
 * Derived from the canonical site-URL form rather than repeating its regexes, so
 * the host a connector builds and the key the resolver caches under cannot drift.
 */
export function normalizeConfluenceDomainHost(domain: string): string {
  return normalizeAtlassianSiteUrl(domain).slice(SITE_URL_SCHEME.length)
}

/**
 * Resolves the `cloudId` for a Confluence site. Memoized per domain by the
 * shared Atlassian resolver, which Jira and JSM read through as well.
 *
 * The resolver raises non-OK statuses with the product name attached, so an
 * upstream fault is reported as such rather than as a missing-site error.
 */
export function getConfluenceCloudId(
  domain: string,
  accessToken: string,
  retryOptions?: RetryOptions
): Promise<string> {
  return resolveAtlassianCloudId({ domain, accessToken, product: 'Confluence', retryOptions })
}

function decodeHtmlEntities(text: string): string {
  let decoded = text
  let previous: string

  do {
    previous = decoded
    decoded = decoded
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
    decoded = decoded.replace(/&amp;/g, '&')
  } while (decoded !== previous)

  return decoded
}

function stripHtmlTags(html: string): string {
  let text = html
  let previous: string

  do {
    previous = text
    text = text.replace(/<[^>]*>/g, '')
    text = text.replace(/[<>]/g, '')
  } while (text !== previous)

  return text.trim()
}

/**
 * Strips HTML tags and decodes HTML entities from raw Confluence content.
 */
export function cleanHtmlContent(rawContent: string): string {
  let content = stripHtmlTags(rawContent)
  content = decodeHtmlEntities(content)
  content = content.replace(/\s+/g, ' ').trim()
  return content
}

export function transformPageData(data: any) {
  const rawContent =
    data.body?.storage?.value || data.body?.view?.value || data.body?.atlas_doc_format?.value || ''

  const cleanContent = cleanHtmlContent(rawContent)

  return {
    success: true,
    output: {
      ts: new Date().toISOString(),
      pageId: data.id ?? '',
      title: data.title ?? '',
      content: cleanContent,
      status: data.status ?? null,
      spaceId: data.spaceId ?? null,
      parentId: data.parentId ?? null,
      authorId: data.authorId ?? null,
      createdAt: data.createdAt ?? null,
      url: data._links?.webui ?? null,
      body: data.body ?? null,
      version: data.version ?? null,
    },
  }
}
