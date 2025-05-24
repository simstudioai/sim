export async function getJiraCloudId(domain: string, accessToken: string): Promise<string> {
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

  throw new Error('No Jira resources found')
}
