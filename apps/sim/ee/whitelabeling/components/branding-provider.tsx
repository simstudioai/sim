'use client'

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { BrandConfig } from '@/lib/branding/types'
import { getBrandConfig } from '@/ee/whitelabeling/branding'
import { useWhitelabelSettings } from '@/ee/whitelabeling/hooks/whitelabel'
import { generateOrgThemeCSS, mergeOrgBrandConfig } from '@/ee/whitelabeling/org-branding-utils'
import { useOrganizations } from '@/hooks/queries/organization'

const LOGO_CACHE_KEY = 'sim-wl-logo'

function readCachedLogoUrl(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return localStorage.getItem(LOGO_CACHE_KEY)
  } catch {
    return null
  }
}

function writeCachedLogoUrl(logoUrl: string | null) {
  try {
    if (logoUrl) {
      localStorage.setItem(LOGO_CACHE_KEY, logoUrl)
    } else {
      localStorage.removeItem(LOGO_CACHE_KEY)
    }
  } catch {}
}

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
 * Injects CSS variable overrides when org colors are configured.
 * Caches the org logo URL in localStorage to eliminate the flash on subsequent loads.
 */
export function BrandingProvider({ children }: BrandingProviderProps) {
  const [cachedLogoUrl] = useState<string | null>(readCachedLogoUrl)

  const { data: orgsData, isLoading: orgsLoading } = useOrganizations()
  const orgId = orgsData?.activeOrganization?.id
  const { data: orgSettings, isLoading: settingsLoading } = useWhitelabelSettings(orgId)

  // Once real settings arrive, keep the cache in sync.
  useEffect(() => {
    if (!orgId || settingsLoading) return
    writeCachedLogoUrl(orgSettings?.logoUrl ?? null)
  }, [orgId, settingsLoading, orgSettings?.logoUrl])

  // True while we're still resolving which logo to show.
  const brandingLoading = orgsLoading || (Boolean(orgId) && settingsLoading)

  const brandConfig = useMemo(() => {
    const base = mergeOrgBrandConfig(orgSettings ?? null, getBrandConfig())
    // While loading, inject the cached logo so the correct logo appears immediately
    // on repeat visits. Once loading completes, real data takes over.
    if (brandingLoading && cachedLogoUrl) {
      return { ...base, logoUrl: cachedLogoUrl }
    }
    return base
  }, [orgSettings, brandingLoading, cachedLogoUrl])

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
