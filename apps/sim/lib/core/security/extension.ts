import { getEnv } from '@/lib/core/config/env'

/** Exact deployment-owned extension IDs; malformed configuration fails closed. */
export function getBrowserExtensionIds(): string[] {
  const configured = getEnv('BROWSER_EXTENSION_IDS')
  if (!configured || configured.length > 1_024) return []
  const ids = configured.split(',').map((id) => id.trim())
  if (ids.length > 16 || ids.some((id) => !/^[a-p]{32}$/.test(id))) return []
  return [...new Set(ids)]
}

export function getBrowserExtensionOrigins(): string[] {
  return getBrowserExtensionIds().map((id) => `chrome-extension://${id}`)
}
