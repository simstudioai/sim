import { getEnv } from '@/lib/core/config/env'

/** Exact deployment-owned extension origins; malformed configuration fails closed. */
export function getBrowserExtensionOrigins(): string[] {
  const configured = getEnv('BROWSER_EXTENSION_IDS')
  if (!configured || configured.length > 1_024) return []
  const ids = configured.split(',').map((id) => id.trim())
  if (ids.length > 16 || ids.some((id) => !/^[a-p]{32}$/.test(id))) return []
  return [...new Set(ids)].map((id) => `chrome-extension://${id}`)
}
