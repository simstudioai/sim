'use client'

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { BrandConfig } from '@/lib/branding/types'
import { getBrandConfig } from '@/ee/whitelabeling/branding'
import { useWhitelabelSettings } from '@/ee/whitelabeling/hooks/whitelabel'
import { generateOrgThemeCSS, mergeOrgBrandConfig } from '@/ee/whitelabeling/org-branding-utils'
import { useOrganizations } from '@/hooks/queries/organization'

const BRAND_CACHE_KEY = 'sim-wl'

interface BrandCache {
  logoUrl?: string
  wordmarkUrl?: string
}

function readCache(): BrandCache | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(BRAND_CACHE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function writeCache(logoUrl: string | null, wordmarkUrl: string | null) {
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

interface BrandingContextValue {
  config: BrandConfig
}

const BrandingContext = createContext<BrandingContextValue>({
  config: getBrandConfig(),
})

interface BrandingProviderProps {
  children: React.ReactNode
}

export function BrandingProvider({ children }: BrandingProviderProps) {
  const [cache] = useState<BrandCache | null>(readCache)

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
        ...(cache.logoUrl && !base.logoUrl && { logoUrl: cache.logoUrl }),
        ...(cache.wordmarkUrl && !base.wordmarkUrl && { wordmarkUrl: cache.wordmarkUrl }),
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

export function useOrgBrandConfig(): BrandConfig {
  return useContext(BrandingContext).config
}
