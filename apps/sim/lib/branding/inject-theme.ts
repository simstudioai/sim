import { getBrandConfig } from './branding'

// Helper to detect if background is dark
function isDarkBackground(hexColor: string): boolean {
  const hex = hexColor.replace('#', '')
  const r = Number.parseInt(hex.substr(0, 2), 16)
  const g = Number.parseInt(hex.substr(2, 2), 16)
  const b = Number.parseInt(hex.substr(4, 2), 16)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance < 0.5
}

export function generateThemeCSS(): string {
  const cssVars: string[] = []
  const brandConfig = getBrandConfig()

  // Use environment variables if set, otherwise fall back to branding.ts defaults
  const primaryColor =
    process.env.NEXT_PUBLIC_BRAND_PRIMARY_COLOR || brandConfig.theme?.primaryColor
  const primaryHoverColor =
    process.env.NEXT_PUBLIC_BRAND_PRIMARY_HOVER_COLOR || brandConfig.theme?.primaryHoverColor
  const secondaryColor =
    process.env.NEXT_PUBLIC_BRAND_SECONDARY_COLOR || brandConfig.theme?.secondaryColor
  const accentColor = process.env.NEXT_PUBLIC_BRAND_ACCENT_COLOR || brandConfig.theme?.accentColor
  const accentHoverColor =
    process.env.NEXT_PUBLIC_BRAND_ACCENT_HOVER_COLOR || brandConfig.theme?.accentHoverColor
  const backgroundColor =
    process.env.NEXT_PUBLIC_BRAND_BACKGROUND_COLOR || brandConfig.theme?.backgroundColor

  if (primaryColor) {
    cssVars.push(`--brand-primary-hex: ${primaryColor};`)
  }

  if (primaryHoverColor) {
    cssVars.push(`--brand-primary-hover-hex: ${primaryHoverColor};`)
  }

  if (secondaryColor) {
    cssVars.push(`--brand-secondary-hex: ${secondaryColor};`)
  }

  if (accentColor) {
    cssVars.push(`--brand-accent-hex: ${accentColor};`)
  }

  if (accentHoverColor) {
    cssVars.push(`--brand-accent-hover-hex: ${accentHoverColor};`)
  }

  if (backgroundColor) {
    cssVars.push(`--brand-background-hex: ${backgroundColor};`)

    // Add dark theme class when background is dark
    const isDark = isDarkBackground(backgroundColor)
    if (isDark) {
      cssVars.push(`--brand-is-dark: 1;`)
    }
  }

  return cssVars.length > 0 ? `:root { ${cssVars.join(' ')} }` : ''
}
