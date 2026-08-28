export function fetchConfluencePage(input: {
  cloudId: string
  pageId: string
  accessToken: string
  signal?: AbortSignal
}): Promise<Response> {
  const url = `https://api.atlassian.com/ex/confluence/${input.cloudId}/wiki/api/v2/pages/${input.pageId}?body-format=storage`
  return fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${input.accessToken}`,
    },
    redirect: 'error',
    signal: input.signal,
  })
}
