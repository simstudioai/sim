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

export function transformPageData(data: any) {
  // Get content from wherever we can find it
  const content =
    data.body?.view?.value ||
    data.body?.storage?.value ||
    data.body?.atlas_doc_format?.value ||
    data.content ||
    data.description ||
    `Content for page ${data.title || 'Unknown'}`

  const cleanContent = content
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()

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
