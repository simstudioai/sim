'use client'

import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import type { BrandConfig } from '@/lib/branding/types'
import { getBrandConfig } from '@/ee/whitelabeling/branding'
import { useWhitelabelSettings } from '@/ee/whitelabeling/hooks/whitelabel'
import { generateOrgThemeCSS, mergeOrgBrandConfig } from '@/ee/whitelabeling/org-branding-utils'
import { useOrganizations } from '@/hooks/queries/organization'

const BRAND_CACHE_KEY = 'sim-wl'

/**
 * Locally-cached brand asset URLs persisted across page loads.
 * Written after org settings resolve; read immediately on mount to
 * eliminate the flash of the default logo on returning visits.
 */
interface BrandCache {
  logoUrl?: string
  wordmarkUrl?: string
}

function readCache(): BrandCache | null {
  try {
    const raw = localStorage.getItem(BRAND_CACHE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function writeCache(logoUrl: string | null, wordmarkUrl: string | null): void {
  try {
    const entry: BrandCache = {}
    if (logoUrl) entry.logoUrl = logoUrl
    if (wordmarkUrl) entry.wordmarkUrl = wordmarkUrl
    if (Object.keys(entry).length > 0) {
      localStorage.setItem(BRAND_CACHE_KEY, JSON.stringify(entry))
    } else {
      localStorage.removeItem(BRAND_CACHE_KEY)
    }
  } catch {}
}

/**
 * Runs as `useLayoutEffect` on the client (before paint) and falls back to
 * `useEffect` on the server where layout effects are a no-op. This prevents
 * the flash of the default logo without triggering a hydration mismatch.
 */
const useBrowserLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

interface BrandingContextValue {
  config: BrandConfig
}

const BrandingContext = createContext<BrandingContextValue>({
  config: getBrandConfig(),
})

interface BrandingProviderProps {
  children: React.ReactNode
}

/**
 * Provides merged branding (instance env vars + org DB settings) to the workspace.
 * Injects a `<style>` tag with CSS variable overrides when org colors are configured.
 *
 * Brand asset URLs are cached in `localStorage` so returning visitors see the
 * correct logo and wordmark immediately. The cache is applied via a layout effect
 * (before the first paint) to eliminate any visible flash on subsequent loads.
 */
export function BrandingProvider({ children }: BrandingProviderProps) {
  const [cache, setCache] = useState<BrandCache | null>(null)

  useBrowserLayoutEffect(() => {
    setCache(readCache())
  }, [])

  const { data: orgsData, isLoading: orgsLoading } = useOrganizations()
  const orgId = orgsData?.activeOrganization?.id
  const { data: orgSettings, isLoading: settingsLoading } = useWhitelabelSettings(orgId)

  useEffect(() => {
    if (!orgId || settingsLoading) return
    writeCache(orgSettings?.logoUrl ?? null, orgSettings?.wordmarkUrl ?? null)
  }, [orgId, settingsLoading, orgSettings?.logoUrl, orgSettings?.wordmarkUrl])

  const brandingLoading = orgsLoading || (Boolean(orgId) && settingsLoading)

  const brandConfig = useMemo(() => {
    const base = mergeOrgBrandConfig(orgSettings ?? null, getBrandConfig())
    if (brandingLoading && cache) {
      return {
        ...base,
        ...(cache.logoUrl && { logoUrl: cache.logoUrl }),
        ...(cache.wordmarkUrl && { wordmarkUrl: cache.wordmarkUrl }),
      }
    }
    return base
  }, [orgSettings, brandingLoading, cache])

  const themeCSS = useMemo(
    () => (orgSettings ? generateOrgThemeCSS(orgSettings) : ''),
    [orgSettings]
  )

  return (
    <BrandingContext.Provider value={{ config: brandConfig }}>
      {themeCSS && <style>{themeCSS}</style>}
      {children}
    </BrandingContext.Provider>
  )
}

/**
 * Returns the merged brand config (org settings overlaid on instance defaults).
 * Use this inside the workspace instead of `getBrandConfig()`.
 */
export function useOrgBrandConfig(): BrandConfig {
  return useContext(BrandingContext).config
}
