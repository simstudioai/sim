import { getEnv } from '@/lib/env'

export interface BrandConfig {
  name: string
  logoUrl?: string
  faviconUrl?: string
  primaryColor?: string
  secondaryColor?: string
  accentColor?: string
  customCssUrl?: string
  hideBranding?: boolean
  footerText?: string
  supportEmail?: string
  supportUrl?: string
  documentationUrl?: string
  termsUrl?: string
  privacyUrl?: string
}

/**
 * Default brand configuration values
 */
const defaultConfig: BrandConfig = {
  name: 'Sim',
  logoUrl: undefined,
  faviconUrl: '/favicon/favicon.ico',
  primaryColor: '#000000',
  secondaryColor: '#6366f1',
  accentColor: '#f59e0b',
  customCssUrl: undefined,
  hideBranding: false,
  footerText: undefined,
  supportEmail: 'help@sim.ai',
  supportUrl: undefined,
  documentationUrl: undefined,
  termsUrl: undefined,
  privacyUrl: undefined,
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
    primaryColor: getEnv('NEXT_PUBLIC_BRAND_PRIMARY_COLOR') || defaultConfig.primaryColor,
    secondaryColor: getEnv('NEXT_PUBLIC_BRAND_SECONDARY_COLOR') || defaultConfig.secondaryColor,
    accentColor: getEnv('NEXT_PUBLIC_BRAND_ACCENT_COLOR') || defaultConfig.accentColor,
    customCssUrl: getEnv('NEXT_PUBLIC_CUSTOM_CSS_URL') || defaultConfig.customCssUrl,
    hideBranding: getEnv('NEXT_PUBLIC_HIDE_BRANDING') === 'true',
    footerText: getEnv('NEXT_PUBLIC_CUSTOM_FOOTER_TEXT') || defaultConfig.footerText,
    supportEmail: getEnv('NEXT_PUBLIC_SUPPORT_EMAIL') || defaultConfig.supportEmail,
    supportUrl: getEnv('NEXT_PUBLIC_SUPPORT_URL') || defaultConfig.supportUrl,
    documentationUrl: getEnv('NEXT_PUBLIC_DOCUMENTATION_URL') || defaultConfig.documentationUrl,
    termsUrl: getEnv('NEXT_PUBLIC_TERMS_URL') || defaultConfig.termsUrl,
    privacyUrl: getEnv('NEXT_PUBLIC_PRIVACY_URL') || defaultConfig.privacyUrl,
  }
}

/**
 * Generate CSS custom properties for brand colors
 */
export const generateBrandCSS = (config: BrandConfig): string => {
  return `
    :root {
      --brand-primary: ${config.primaryColor};
      --brand-secondary: ${config.secondaryColor};
      --brand-accent: ${config.accentColor};
    }
  `
}

/**
 * Hook to use brand configuration in React components
 */
export const useBrandConfig = () => {
  return getBrandConfig()
}
