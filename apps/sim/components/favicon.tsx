'use client'

import { type ReactNode, useState } from 'react'
import { cn } from '@sim/emcn'
import { LRUCache } from 'lru-cache'
import { faviconSrc } from '@/lib/favicon/url'

/**
 * Hosts whose icon just failed, so an icon that mounts again renders its fallback at once
 * instead of an empty slot first. An `<img>` can't tell no icon from a provider outage, so this
 * lasts only as long as the route retries an outage; a confirmed miss stays in the HTTP cache.
 */
const knownMisses = new LRUCache<string, true>({ max: 500, ttl: 5 * 60 * 1000 })

interface FaviconProps {
  /** The site's hostname; without one the fallback renders. */
  host: string | null | undefined
  /** Rendered when there is no host, or when neither the host nor a parent domain has an icon. */
  fallback: ReactNode
  /** Sizing for the icon; the fallback carries its own. */
  className?: string
}

/**
 * A site's icon, served by Sim's favicon route: the browser never contacts a third party, a
 * private tenant shows its platform's icon, and a site with none renders `fallback` instead
 * of a provider's placeholder.
 */
export function Favicon({ host, fallback, className }: FaviconProps) {
  const [failedHost, setFailedHost] = useState<string | null>(null)
  if (!host || failedHost === host || knownMisses.has(host)) return fallback
  return (
    <img
      src={faviconSrc(host)}
      alt=''
      loading='lazy'
      decoding='async'
      className={cn('rounded-sm', className)}
      onError={() => {
        knownMisses.set(host, true)
        setFailedHost(host)
      }}
    />
  )
}
