import type { BrandConfig, OrganizationWhitelabelSettings } from '@/lib/branding/types'
import { getContrastTextColor } from '@/lib/colors'

/**
 * Merge org-level whitelabel settings over the instance-level brand config.
 * Org settings take priority for any field they define.
 */
export function mergeOrgBrandConfig(
  orgSettings: OrganizationWhitelabelSettings | null,
  instanceConfig: BrandConfig
): BrandConfig {
  if (!orgSettings) {
    return instanceConfig
  }

  return {
    ...instanceConfig,
    name: orgSettings.brandName || instanceConfig.name,
    logoUrl: orgSettings.logoUrl || instanceConfig.logoUrl,
    wordmarkUrl: orgSettings.wordmarkUrl || instanceConfig.wordmarkUrl,
    supportEmail: orgSettings.supportEmail || instanceConfig.supportEmail,
    documentationUrl: orgSettings.documentationUrl || instanceConfig.documentationUrl,
    termsUrl: orgSettings.termsUrl || instanceConfig.termsUrl,
    privacyUrl: orgSettings.privacyUrl || instanceConfig.privacyUrl,
    theme: {
      ...instanceConfig.theme,
      ...(orgSettings.primaryColor && { primaryColor: orgSettings.primaryColor }),
      ...(orgSettings.primaryHoverColor && { primaryHoverColor: orgSettings.primaryHoverColor }),
      ...(orgSettings.accentColor && { accentColor: orgSettings.accentColor }),
      ...(orgSettings.accentHoverColor && { accentHoverColor: orgSettings.accentHoverColor }),
    },
    isWhitelabeled:
      instanceConfig.isWhitelabeled ||
      Boolean(
        orgSettings.brandName ||
          orgSettings.logoUrl ||
          orgSettings.wordmarkUrl ||
          orgSettings.primaryColor
      ),
  }
}

/**
 * Generate CSS variable overrides from org whitelabel settings.
 * Returns an empty string when no color overrides are set.
 */
export function generateOrgThemeCSS(settings: OrganizationWhitelabelSettings): string {
  const vars: string[] = []

  if (settings.primaryColor) {
    vars.push(`--brand: ${settings.primaryColor};`)
    vars.push(`--brand-agent: ${settings.primaryColor};`)
    vars.push(`--brand-accent: ${settings.primaryColor};`)
    vars.push(`--auth-primary-btn-bg: ${settings.primaryColor};`)
    vars.push(`--auth-primary-btn-border: ${settings.primaryColor};`)
    vars.push(`--auth-primary-btn-hover-bg: ${settings.primaryColor};`)
    vars.push(`--auth-primary-btn-hover-border: ${settings.primaryColor};`)
    const textColor = getContrastTextColor(settings.primaryColor)
    vars.push(`--auth-primary-btn-text: ${textColor};`)
    vars.push(`--auth-primary-btn-hover-text: ${textColor};`)
  }

  if (settings.primaryHoverColor) {
    vars.push(`--brand-hover: ${settings.primaryHoverColor};`)
    vars.push(`--brand-accent-hover: ${settings.primaryHoverColor};`)
    vars.push(`--auth-primary-btn-hover-bg: ${settings.primaryHoverColor};`)
    vars.push(`--auth-primary-btn-hover-border: ${settings.primaryHoverColor};`)
    vars.push(`--auth-primary-btn-hover-text: ${getContrastTextColor(settings.primaryHoverColor)};`)
  }

  if (settings.accentColor) {
    vars.push(`--brand-accent: ${settings.accentColor};`)
  }

  if (settings.accentHoverColor) {
    vars.push(`--brand-accent-hover: ${settings.accentHoverColor};`)
  }

  return vars.length > 0 ? `:root { ${vars.join(' ')} }` : ''
}
