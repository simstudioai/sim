import { getEnv } from '@/lib/env'

export interface ThemeColors {
  primaryColor?: string
  primaryHoverColor?: string
  secondaryColor?: string
  accentColor?: string
  accentHoverColor?: string
  backgroundColor?: string
}

export interface BrandConfig {
  name: string
  logoUrl?: string
  faviconUrl?: string
  customCssUrl?: string
  supportEmail?: string
  documentationUrl?: string
  termsUrl?: string
  privacyUrl?: string
  theme?: ThemeColors
}

/**
 * Default brand configuration values
 */
const defaultConfig: BrandConfig = {
  name: 'Sim',
  logoUrl: undefined,
  faviconUrl: '/favicon/favicon.ico',
  customCssUrl: undefined,
  supportEmail: 'help@sim.ai',
  documentationUrl: undefined,
  termsUrl: undefined,
  privacyUrl: undefined,
  theme: {
    primaryColor: '#701ffc',
    primaryHoverColor: '#802fff',
    secondaryColor: '#6518e6',
    accentColor: '#9d54ff',
    accentHoverColor: '#a66fff',
    backgroundColor: '#0c0c0c',
  },
}

const getThemeColors = (): ThemeColors => {
  return {
    primaryColor: getEnv('NEXT_PUBLIC_BRAND_PRIMARY_COLOR') || defaultConfig.theme?.primaryColor,
    primaryHoverColor:
      getEnv('NEXT_PUBLIC_BRAND_PRIMARY_HOVER_COLOR') || defaultConfig.theme?.primaryHoverColor,
    secondaryColor:
      getEnv('NEXT_PUBLIC_BRAND_SECONDARY_COLOR') || defaultConfig.theme?.secondaryColor,
    accentColor: getEnv('NEXT_PUBLIC_BRAND_ACCENT_COLOR') || defaultConfig.theme?.accentColor,
    accentHoverColor:
      getEnv('NEXT_PUBLIC_BRAND_ACCENT_HOVER_COLOR') || defaultConfig.theme?.accentHoverColor,
    backgroundColor:
      getEnv('NEXT_PUBLIC_BRAND_BACKGROUND_COLOR') || defaultConfig.theme?.backgroundColor,
  }
}

/**
 * Get branding configuration from environment variables
 * Supports runtime configuration via Docker/Kubernetes
 */
export const getBrandConfig = (): BrandConfig => {
  return {
    name: getEnv('NEXT_PUBLIC_BRAND_NAME') || defaultConfig.name,
    logoUrl: getEnv('NEXT_PUBLIC_BRAND_LOGO_URL') || defaultConfig.logoUrl,
    faviconUrl: getEnv('NEXT_PUBLIC_BRAND_FAVICON_URL') || defaultConfig.faviconUrl,
    customCssUrl: getEnv('NEXT_PUBLIC_CUSTOM_CSS_URL') || defaultConfig.customCssUrl,
    supportEmail: getEnv('NEXT_PUBLIC_SUPPORT_EMAIL') || defaultConfig.supportEmail,
    documentationUrl: getEnv('NEXT_PUBLIC_DOCUMENTATION_URL') || defaultConfig.documentationUrl,
    termsUrl: getEnv('NEXT_PUBLIC_TERMS_URL') || defaultConfig.termsUrl,
    privacyUrl: getEnv('NEXT_PUBLIC_PRIVACY_URL') || defaultConfig.privacyUrl,
    theme: getThemeColors(),
  }
}

/**
 * Hook to use brand configuration in React components
 */
export const useBrandConfig = () => {
  return getBrandConfig()
}
