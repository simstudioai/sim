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

export function generateThemeCSS(): string {
  const cssVars: string[] = []

  if (process.env.NEXT_PUBLIC_BRAND_PRIMARY_COLOR) {
    cssVars.push(`--brand: ${process.env.NEXT_PUBLIC_BRAND_PRIMARY_COLOR};`)
    // Override brand-accent so Run/Deploy buttons and other accent-styled elements use the brand color
    cssVars.push(`--brand-accent: ${process.env.NEXT_PUBLIC_BRAND_PRIMARY_COLOR};`)
  }

  if (process.env.NEXT_PUBLIC_BRAND_PRIMARY_HOVER_COLOR) {
    cssVars.push(`--brand-hover: ${process.env.NEXT_PUBLIC_BRAND_PRIMARY_HOVER_COLOR};`)
  }

  if (process.env.NEXT_PUBLIC_BRAND_ACCENT_COLOR) {
    cssVars.push(`--brand-link: ${process.env.NEXT_PUBLIC_BRAND_ACCENT_COLOR};`)
  }

  if (process.env.NEXT_PUBLIC_BRAND_ACCENT_HOVER_COLOR) {
    cssVars.push(`--brand-link-hover: ${process.env.NEXT_PUBLIC_BRAND_ACCENT_HOVER_COLOR};`)
  }

  if (process.env.NEXT_PUBLIC_BRAND_BACKGROUND_COLOR) {
    // Add dark theme class when background is dark
    const isDark = isDarkBackground(process.env.NEXT_PUBLIC_BRAND_BACKGROUND_COLOR)
    if (isDark) {
      cssVars.push(`--brand-is-dark: 1;`)
    }
  }

  return cssVars.length > 0 ? `:root { ${cssVars.join(' ')} }` : ''
}
