/** Canonical storage kind; names and extensions are presentation only. */
export const DASHBOARD_CONTENT_TYPE = 'text/x-sim-dashboard'

/** Backing file extensions are not part of a dashboard's resource name. */
export function dashboardDisplayName(name: string): string {
  return name.replace(/\.dashboard$/i, '')
}

export function fileBackedResourceType(contentType: string): 'dashboard' | 'file' {
  return contentType === DASHBOARD_CONTENT_TYPE ? 'dashboard' : 'file'
}
