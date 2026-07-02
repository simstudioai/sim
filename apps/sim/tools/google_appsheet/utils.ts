const DEFAULT_REGION = 'www'

/**
 * Builds the AppSheet API Action endpoint URL for a given app/table/region.
 * Region defaults to the global `www.appsheet.com` domain when unset.
 */
export function buildAppsheetActionUrl(appId: string, tableName: string, region?: string): string {
  const host = `${(region || DEFAULT_REGION).trim()}.appsheet.com`
  return `https://${host}/api/v2/apps/${appId.trim()}/tables/${encodeURIComponent(tableName.trim())}/Action`
}

/**
 * Safely reads an AppSheet API response body. AppSheet does not consistently
 * document whether every Action returns a JSON body (e.g. Delete may return an
 * empty body on some accounts), so this avoids `response.json()` throwing on
 * empty or non-JSON content.
 */
export async function readAppsheetResponseBody(response: Response): Promise<Record<string, any>> {
  const text = await response.text()
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    return { message: text }
  }
}
