const DEFAULT_REGION = 'www'

/**
 * Builds the AppSheet API Action endpoint URL for a given app/table/region.
 * Region defaults to the global `www.appsheet.com` domain when unset.
 */
export function buildAppsheetActionUrl(appId: string, tableName: string, region?: string): string {
  const host = `${(region || DEFAULT_REGION).trim()}.appsheet.com`
  return `https://${host}/api/v2/apps/${appId.trim()}/tables/${encodeURIComponent(tableName.trim())}/Action`
}
