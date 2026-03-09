/**
 * Fetches all pages from a paginated API endpoint.
 *
 * The endpoint is expected to return `{ data: T[], pagination: { hasMore: boolean } }`.
 * Pages are fetched sequentially until `hasMore` is `false`.
 *
 * @param baseUrl - Base URL including any existing query params (e.g. `/api/workflows?workspaceId=ws-1`)
 * @param pageSize - Number of items per page (default 200)
 * @returns All items concatenated across pages
 */
export async function fetchAllPages<T>(baseUrl: string, pageSize = 200): Promise<T[]> {
  const allItems: T[] = []
  let offset = 0
  const separator = baseUrl.includes('?') ? '&' : '?'

  while (true) {
    const response = await fetch(`${baseUrl}${separator}limit=${pageSize}&offset=${offset}`)

    if (!response.ok) {
      throw new Error(`Failed to fetch from ${baseUrl}: ${response.statusText}`)
    }

    const json = await response.json()
    const data: T[] = json.data
    allItems.push(...data)

    if (!json.pagination?.hasMore) {
      break
    }

    offset += pageSize
  }

  return allItems
}
