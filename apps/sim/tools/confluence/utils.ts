export async function getConfluenceCloudId(domain: string, accessToken: string): Promise<string> {
  const response = await fetch('https://api.atlassian.com/oauth/token/accessible-resources', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  })

  const resources = await response.json()

  // If we have resources, find the matching one
  if (Array.isArray(resources) && resources.length > 0) {
    const normalizedInput = `https://${domain}`.toLowerCase()
    const matchedResource = resources.find((r) => r.url.toLowerCase() === normalizedInput)

    if (matchedResource) {
      return matchedResource.id
    }
  }

  // If we couldn't find a match, return the first resource's ID
  // This is a fallback in case the URL matching fails
  if (Array.isArray(resources) && resources.length > 0) {
    return resources[0].id
  }

  throw new Error('No Confluence resources found')
}

/**
 * Safely decode HTML entities
 * Uses repeated replacement to prevent double-escaping vulnerabilities
 * This prevents attacks where &amp;lt; becomes &lt; then <
 */
function decodeHtmlEntities(text: string): string {
  let decoded = text
  let previous: string

  // Repeat until no more entities are decoded
  // This ensures nested entities like &amp;lt; are fully resolved
  do {
    previous = decoded
    // Decode specific entities (but NOT &amp; yet)
    decoded = decoded
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
    // Decode &amp; LAST to prevent double-decoding
    decoded = decoded.replace(/&amp;/g, '&')
  } while (decoded !== previous)

  return decoded
}

/**
 * Safely strip HTML tags from a string
 * Uses repeated replacement to prevent incomplete sanitization
 */
function stripHtmlTags(html: string): string {
  let text = html
  let previous: string

  do {
    previous = text
    // Remove HTML tags
    text = text.replace(/<[^>]*>/g, '')
    // Also remove < and > characters that might remain
    text = text.replace(/[<>]/g, '')
  } while (text !== previous)

  return text.trim()
}

export function transformPageData(data: any) {
  // Get content from wherever we can find it
  const content =
    data.body?.view?.value ||
    data.body?.storage?.value ||
    data.body?.atlas_doc_format?.value ||
    data.content ||
    data.description ||
    `Content for page ${data.title || 'Unknown'}`

  // First strip HTML tags, then decode entities, then normalize whitespace
  let cleanContent = stripHtmlTags(content)
  cleanContent = decodeHtmlEntities(cleanContent)
  cleanContent = cleanContent.replace(/\s+/g, ' ').trim()

  return {
    success: true,
    output: {
      ts: new Date().toISOString(),
      pageId: data.id || '',
      content: cleanContent,
      title: data.title || '',
    },
  }
}
