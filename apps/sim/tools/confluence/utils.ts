export async function getConfluenceCloudId(domain: string, accessToken: string): Promise<string> {
  const response = await fetch('https://api.atlassian.com/oauth/token/accessible-resources', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  })

  const resources = await response.json()

  if (Array.isArray(resources) && resources.length > 0) {
    const normalizedInput = `https://${domain}`.toLowerCase()
    const matchedResource = resources.find((r) => r.url.toLowerCase() === normalizedInput)

    if (matchedResource) {
      return matchedResource.id
    }
  }

  if (Array.isArray(resources) && resources.length > 0) {
    return resources[0].id
  }

  throw new Error('No Confluence resources found')
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

export function transformPageData(data: any) {
  const rawContent =
    data.body?.storage?.value || data.body?.view?.value || data.body?.atlas_doc_format?.value || ''

  let cleanContent = stripHtmlTags(rawContent)
  cleanContent = decodeHtmlEntities(cleanContent)
  cleanContent = cleanContent.replace(/\s+/g, ' ').trim()

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
