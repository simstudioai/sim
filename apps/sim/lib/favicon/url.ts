import { getFaviconContract } from '@/lib/api/contracts/favicon'

/** Sim's favicon route for a host; the browser never asks a third party for the icon. */
export function faviconSrc(host: string): string {
  return `${getFaviconContract.path}?host=${encodeURIComponent(host)}`
}

/**
 * The hostname of an absolute http(s) URL, the one part of a link a site icon is looked up by.
 * Null for relative, anchor, `mailto:` and other schemes, and for anything that doesn't parse.
 */
export function siteHost(url: string | null | undefined): string | null {
  if (!url || !/^https?:\/\//i.test(url)) return null
  try {
    return new URL(url).hostname || null
  } catch {
    return null
  }
}
