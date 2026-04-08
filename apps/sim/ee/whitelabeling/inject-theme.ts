/**
 * Helper to detect if background is dark
 */
function isDarkBackground(hexColor: string): boolean {
  const hex = hexColor.replace('#', '')
  const r = Number.parseInt(hex.substr(0, 2), 16)
  const g = Number.parseInt(hex.substr(2, 2), 16)
  const b = Number.parseInt(hex.substr(4, 2), 16)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance < 0.5
}

function getContrastTextColor(hexColor: string): string {
  return isDarkBackground(hexColor) ? '#ffffff' : '#000000'
}

export function generateThemeCSS(): string {
  const cssVars: string[] = []

  if (process.env.NEXT_PUBLIC_BRAND_PRIMARY_COLOR) {
    cssVars.push(`--brand: ${process.env.NEXT_PUBLIC_BRAND_PRIMARY_COLOR};`)
    cssVars.push(`--brand-accent: ${process.env.NEXT_PUBLIC_BRAND_PRIMARY_COLOR};`)
    cssVars.push(`--auth-primary-btn-bg: ${process.env.NEXT_PUBLIC_BRAND_PRIMARY_COLOR};`)
    cssVars.push(`--auth-primary-btn-border: ${process.env.NEXT_PUBLIC_BRAND_PRIMARY_COLOR};`)
    cssVars.push(`--auth-primary-btn-hover-bg: ${process.env.NEXT_PUBLIC_BRAND_PRIMARY_COLOR};`)
    cssVars.push(`--auth-primary-btn-hover-border: ${process.env.NEXT_PUBLIC_BRAND_PRIMARY_COLOR};`)
    const primaryTextColor = getContrastTextColor(process.env.NEXT_PUBLIC_BRAND_PRIMARY_COLOR)
    cssVars.push(`--auth-primary-btn-text: ${primaryTextColor};`)
    cssVars.push(`--auth-primary-btn-hover-text: ${primaryTextColor};`)
  }

  if (process.env.NEXT_PUBLIC_BRAND_PRIMARY_HOVER_COLOR) {
    cssVars.push(`--brand-hover: ${process.env.NEXT_PUBLIC_BRAND_PRIMARY_HOVER_COLOR};`)
    cssVars.push(`--brand-accent-hover: ${process.env.NEXT_PUBLIC_BRAND_PRIMARY_HOVER_COLOR};`)
    cssVars.push(
      `--auth-primary-btn-hover-bg: ${process.env.NEXT_PUBLIC_BRAND_PRIMARY_HOVER_COLOR};`
    )
    cssVars.push(
      `--auth-primary-btn-hover-border: ${process.env.NEXT_PUBLIC_BRAND_PRIMARY_HOVER_COLOR};`
    )
    cssVars.push(
      `--auth-primary-btn-hover-text: ${getContrastTextColor(process.env.NEXT_PUBLIC_BRAND_PRIMARY_HOVER_COLOR)};`
    )
  }

  if (process.env.NEXT_PUBLIC_BRAND_ACCENT_COLOR) {
    cssVars.push(`--brand-link: ${process.env.NEXT_PUBLIC_BRAND_ACCENT_COLOR};`)
  }

  if (process.env.NEXT_PUBLIC_BRAND_ACCENT_HOVER_COLOR) {
    cssVars.push(`--brand-link-hover: ${process.env.NEXT_PUBLIC_BRAND_ACCENT_HOVER_COLOR};`)
  }

  if (process.env.NEXT_PUBLIC_BRAND_BACKGROUND_COLOR) {
    const isDark = isDarkBackground(process.env.NEXT_PUBLIC_BRAND_BACKGROUND_COLOR)
    if (isDark) {
      cssVars.push(`--brand-is-dark: 1;`)
    }
  }

  return cssVars.length > 0 ? `:root { ${cssVars.join(' ')} }` : ''
}
