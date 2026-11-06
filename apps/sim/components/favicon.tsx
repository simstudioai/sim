'use client'

import { type ReactNode, useReducer } from 'react'
import { cn } from '@sim/emcn'
import { LRUCache } from 'lru-cache'
import { faviconSrc } from '@/lib/favicon/url'

/**
 * Hosts whose icon failed recently: the only failure record, so mounted and remounted icons
 * render the fallback at once instead of an empty slot. An `<img>` can't tell no icon from a
 * provider outage, so an entry lasts only as long as the route retries an outage; the next render
 * after that asks again, and a confirmed miss stays in the HTTP cache.
 */
const knownMisses = new LRUCache<string, true>({ max: 500, ttl: 5 * 60 * 1000 })

interface FaviconProps {
  /** The site's hostname; without one the fallback renders. */
  host: string | null | undefined
  /** Rendered when there is no host, or when neither the host nor a parent domain has an icon. */
  fallback: ReactNode
  /** Sizing for the icon; the fallback carries its own. */
  className?: string
  /** Reports the image painted, including one the browser had ready before hydration. */
  onLoad?: () => void
}

/**
 * A site's icon, served by Sim's favicon route: the browser never contacts a third party, a
 * private tenant shows its platform's icon, and a site with none renders `fallback` instead
 * of a provider's placeholder.
 */
export function Favicon({ host, fallback, className, onLoad }: FaviconProps) {
  const [, rerender] = useReducer((failures: number) => failures + 1, 0)
  if (!host || knownMisses.has(host)) return fallback
  const recordMiss = () => {
    knownMisses.set(host, true)
    rerender()
  }
  return (
    <img
      ref={(image) => {
        if (!image?.complete) return
        if (image.naturalWidth > 0) onLoad?.()
        // A failure before hydration fires no onError, and a remount would ask for the icon again.
        else void image.decode().catch(recordMiss)
      }}
      src={faviconSrc(host)}
      alt=''
      loading='lazy'
      decoding='async'
      className={cn('rounded-sm', className)}
      onLoad={onLoad}
      onError={recordMiss}
    />
  )
}
