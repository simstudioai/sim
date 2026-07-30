const DEFAULT_REGION = 'www'
const ALLOWED_REGIONS = new Set(['www', 'eu', 'asia-southeast'])

/**
 * Builds the AppSheet API Action endpoint URL for a given app/table/region.
 * Region defaults to the global `www.appsheet.com` domain when unset, and is
 * validated against the known AppSheet regions since it is interpolated into
 * the request host — an unvalidated value would let a caller redirect the
 * Application Access Key to an arbitrary host.
 */
export function buildAppsheetActionUrl(appId: string, tableName: string, region?: string): string {
  const trimmedRegion = (region || DEFAULT_REGION).trim()
  if (!ALLOWED_REGIONS.has(trimmedRegion)) {
    throw new Error(
      `Invalid AppSheet region "${trimmedRegion}". Must be one of: ${Array.from(ALLOWED_REGIONS).join(', ')}.`
    )
  }
  const host = `${trimmedRegion}.appsheet.com`
  return `https://${host}/api/v2/apps/${encodeURIComponent(appId.trim())}/tables/${encodeURIComponent(tableName.trim())}/Action`
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
