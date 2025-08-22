export function generateThemeCSS(): string {
  const cssVars: string[] = []

  if (process.env.NEXT_PUBLIC_BRAND_PRIMARY_COLOR) {
    cssVars.push(`--brand-primary-hex: ${process.env.NEXT_PUBLIC_BRAND_PRIMARY_COLOR};`)
  }

  if (process.env.NEXT_PUBLIC_BRAND_PRIMARY_HOVER_COLOR) {
    cssVars.push(`--brand-primary-hover-hex: ${process.env.NEXT_PUBLIC_BRAND_PRIMARY_HOVER_COLOR};`)
  }

  if (process.env.NEXT_PUBLIC_BRAND_SECONDARY_COLOR) {
    cssVars.push(`--brand-secondary-hex: ${process.env.NEXT_PUBLIC_BRAND_SECONDARY_COLOR};`)
  }

  if (process.env.NEXT_PUBLIC_BRAND_ACCENT_COLOR) {
    cssVars.push(`--brand-accent-hex: ${process.env.NEXT_PUBLIC_BRAND_ACCENT_COLOR};`)
  }

  if (process.env.NEXT_PUBLIC_BRAND_ACCENT_HOVER_COLOR) {
    cssVars.push(`--brand-accent-hover-hex: ${process.env.NEXT_PUBLIC_BRAND_ACCENT_HOVER_COLOR};`)
  }

  if (process.env.NEXT_PUBLIC_BRAND_BACKGROUND_COLOR) {
    cssVars.push(`--brand-background-hex: ${process.env.NEXT_PUBLIC_BRAND_BACKGROUND_COLOR};`)
  }

  return cssVars.length > 0 ? `:root { ${cssVars.join(' ')} }` : ''
}
