'use client'

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { BrandConfig } from '@/lib/branding/types'
import { getBrandConfig } from '@/ee/whitelabeling/branding'
import { useWhitelabelSettings } from '@/ee/whitelabeling/hooks/whitelabel'
import { generateOrgThemeCSS, mergeOrgBrandConfig } from '@/ee/whitelabeling/org-branding-utils'
import { useOrganizations } from '@/hooks/queries/organization'

export const BRAND_COOKIE_NAME = 'sim-wl'
const BRAND_COOKIE_MAX_AGE = 30 * 24 * 60 * 60 // 30 days

/**
 * Brand assets and theme CSS cached in a cookie between page loads.
 * The cookie is written client-side after org settings resolve, and read
 * server-side in the workspace layout so the correct branding is baked into
 * the initial HTML — eliminating any flash of default Sim branding.
 */
export interface BrandCache {
  logoUrl?: string
  wordmarkUrl?: string
  /** Pre-generated `:root { ... }` CSS from the last resolved org settings. */
  themeCSS?: string
}

function writeBrandCookie(cache: BrandCache | null): void {
  try {
    const hasContent = cache && Object.keys(cache).length > 0
    if (hasContent) {
      document.cookie = `${BRAND_COOKIE_NAME}=${encodeURIComponent(JSON.stringify(cache))}; path=/; max-age=${BRAND_COOKIE_MAX_AGE}; SameSite=Lax`
    } else {
      document.cookie = `${BRAND_COOKIE_NAME}=; path=/; max-age=0; SameSite=Lax`
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
  /**
   * Brand cache read server-side from the `sim-wl` cookie by the workspace
   * layout. Providing this as an initial prop means the server-rendered HTML
   * already contains the correct logo and colors — no client-side flash.
   */
  initialCache?: BrandCache | null
}

/**
 * Provides merged branding (instance env vars + org DB settings) to the workspace.
 * Injects a `<style>` tag with CSS variable overrides when org colors are configured.
 *
 * On first visit the org logo loads after the API call resolves (one-time flash).
 * On all subsequent visits the workspace layout reads the `sim-wl` cookie server-side
 * and passes it as `initialCache`, so the server renders the correct brand from the
 * first byte — no flash of any kind.
 */
export function BrandingProvider({ children, initialCache }: BrandingProviderProps) {
  const [cache, setCache] = useState<BrandCache | null>(initialCache ?? null)

  const { data: orgsData, isLoading: orgsLoading } = useOrganizations()
  const orgId = orgsData?.activeOrganization?.id
  const { data: orgSettings, isLoading: settingsLoading } = useWhitelabelSettings(orgId)

  useEffect(() => {
    if (!orgId || settingsLoading) return
    const themeCSS = orgSettings ? generateOrgThemeCSS(orgSettings) : null
    const next: BrandCache = {}
    if (orgSettings?.logoUrl) next.logoUrl = orgSettings.logoUrl
    if (orgSettings?.wordmarkUrl) next.wordmarkUrl = orgSettings.wordmarkUrl
    if (themeCSS) next.themeCSS = themeCSS
    writeBrandCookie(Object.keys(next).length > 0 ? next : null)
    setCache(Object.keys(next).length > 0 ? next : null)
  }, [orgId, settingsLoading, orgSettings])

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

  const themeCSS = useMemo(() => {
    if (orgSettings) return generateOrgThemeCSS(orgSettings)
    if (brandingLoading && cache?.themeCSS) return cache.themeCSS
    return ''
  }, [orgSettings, brandingLoading, cache])

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
