import { join } from 'node:path'
import { app } from 'electron'
import { SiteDirectory, type SiteRecord } from '@/main/browser-sites/directory'

/**
 * Composition root for the imported site directory: one store for the whole
 * app, holding what each imported host is called and what it looks like.
 */

let instance: SiteDirectory | null = null

export function siteDirectory(): SiteDirectory {
  if (!instance) {
    instance = new SiteDirectory(join(app.getPath('userData'), 'browser-sites.json'))
  }
  return instance
}

export function listSites(): Promise<SiteRecord[]> {
  return siteDirectory().list()
}

export function rememberSites(records: readonly SiteRecord[]): Promise<void> {
  return siteDirectory().remember(records)
}

/** Runs with the rest of the browser teardown, so no site list outlives sign-out. */
export function clearSites(): Promise<void> {
  return siteDirectory().clear()
}
