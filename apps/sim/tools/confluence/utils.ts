import type { RetryOptions } from '@/lib/knowledge/documents/utils'
import { fetchWithRetry } from '@/lib/knowledge/documents/utils'

function normalizeDomain(domain: string): string {
  return `https://${domain
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')}`.toLowerCase()
}

export async function getConfluenceCloudId(
  domain: string,
  accessToken: string,
  retryOptions?: RetryOptions
): Promise<string> {
  const response = await fetchWithRetry(
    'https://api.atlassian.com/oauth/token/accessible-resources',
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    },
    retryOptions
  )

  const resources = await response.json()

  if (!Array.isArray(resources) || resources.length === 0) {
    throw new Error('No Confluence resources found')
  }

  const normalized = normalizeDomain(domain)
  const match = resources.find(
    (r: { url: string }) => r.url.toLowerCase().replace(/\/+$/, '') === normalized
  )

  if (match) {
    return match.id
  }

  if (resources.length === 1) {
    return resources[0].id
  }

  throw new Error(
    `Could not match Confluence domain "${domain}" to any accessible resource. ` +
      `Available sites: ${resources.map((r: { url: string }) => r.url).join(', ')}`
  )
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
