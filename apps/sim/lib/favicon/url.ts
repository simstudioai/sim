import { getFaviconContract } from '@/lib/api/contracts/favicon'

/** Sim's favicon route for a host; the browser never asks a third party for the icon. */
export function faviconSrc(host: string): string {
  return `${getFaviconContract.path}?host=${encodeURIComponent(host)}`
}
