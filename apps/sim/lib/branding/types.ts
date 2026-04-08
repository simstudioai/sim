export interface ThemeColors {
  primaryColor?: string
  primaryHoverColor?: string
  accentColor?: string
  accentHoverColor?: string
  backgroundColor?: string
}

export interface BrandConfig {
  name: string
  logoUrl?: string
  wordmarkUrl?: string
  faviconUrl?: string
  customCssUrl?: string
  supportEmail?: string
  documentationUrl?: string
  termsUrl?: string
  privacyUrl?: string
  theme?: ThemeColors
  /** Whether this instance has custom branding applied (any brand env var is set) */
  isWhitelabeled: boolean
}

/**
 * Per-organization whitelabel settings stored in the database.
 * Only available for enterprise organizations on the hosted platform.
 */
export interface OrganizationWhitelabelSettings {
  brandName?: string
  logoUrl?: string
  wordmarkUrl?: string
  primaryColor?: string
  primaryHoverColor?: string
  accentColor?: string
  accentHoverColor?: string
  supportEmail?: string
  documentationUrl?: string
  termsUrl?: string
  privacyUrl?: string
  hidePoweredBySim?: boolean
}
