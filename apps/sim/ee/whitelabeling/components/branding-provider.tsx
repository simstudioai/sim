'use client'

import { createContext, useContext, useMemo } from 'react'
import type { BrandConfig } from '@/lib/branding/types'
import { getBrandConfig } from '@/ee/whitelabeling/branding'
import { useWhitelabelSettings } from '@/ee/whitelabeling/hooks/whitelabel'
import { generateOrgThemeCSS, mergeOrgBrandConfig } from '@/ee/whitelabeling/org-branding-utils'
import { useOrganizations } from '@/hooks/queries/organization'

interface BrandingContextValue {
  config: BrandConfig
  isLoading: boolean
}

const BrandingContext = createContext<BrandingContextValue>({
  config: getBrandConfig(),
  isLoading: false,
})

interface BrandingProviderProps {
  children: React.ReactNode
}

/**
 * Provides merged branding (instance env vars + org DB settings) to the workspace.
 * Injects CSS variable overrides when org colors are configured.
 */
export function BrandingProvider({ children }: BrandingProviderProps) {
  const { data: orgsData, isLoading: orgsLoading } = useOrganizations()
  const orgId = orgsData?.activeOrganization?.id
  const { data: orgSettings, isLoading: settingsLoading } = useWhitelabelSettings(orgId)

  const isLoading = orgsLoading || (Boolean(orgId) && settingsLoading)

  const brandConfig = useMemo(
    () => mergeOrgBrandConfig(orgSettings ?? null, getBrandConfig()),
    [orgSettings]
  )

  const themeCSS = useMemo(
    () => (orgSettings ? generateOrgThemeCSS(orgSettings) : ''),
    [orgSettings]
  )

  return (
    <BrandingContext.Provider value={{ config: brandConfig, isLoading }}>
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

/**
 * Returns true while org branding is being fetched.
 * Use this to avoid rendering the logo until the correct one is known.
 */
export function useOrgBrandLoading(): boolean {
  return useContext(BrandingContext).isLoading
}
