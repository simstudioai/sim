export const DASHBOARD_CONTENT_TYPE = 'text/x-sim-dashboard'

const DASHBOARD_SUFFIX = '.dashboard'

/**
 * `.dashboard` is an ingestion signal, like `.html` for pages: the stored name
 * drops it and the content type alone marks the file as a dashboard.
 */
export function stripDashboardSuffix(name: string): string | null {
  if (!name.toLowerCase().endsWith(DASHBOARD_SUFFIX)) return null
  return name.slice(0, -DASHBOARD_SUFFIX.length) || null
}
