import { getContrastTextColor, isDarkColor } from '@/lib/colors'

export function generateThemeCSS(): string {
  const cssVars: string[] = []

  if (process.env.NEXT_PUBLIC_BRAND_PRIMARY_COLOR) {
    cssVars.push(`--brand: ${process.env.NEXT_PUBLIC_BRAND_PRIMARY_COLOR};`)
    cssVars.push(`--brand-agent: ${process.env.NEXT_PUBLIC_BRAND_PRIMARY_COLOR};`)
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
    cssVars.push(`--brand-accent: ${process.env.NEXT_PUBLIC_BRAND_ACCENT_COLOR};`)
  }

  if (process.env.NEXT_PUBLIC_BRAND_ACCENT_HOVER_COLOR) {
    cssVars.push(`--brand-accent-hover: ${process.env.NEXT_PUBLIC_BRAND_ACCENT_HOVER_COLOR};`)
  }

  if (process.env.NEXT_PUBLIC_CUSTOM_CSS_URL) {
    cssVars.push('--brand-agent: var(--brand);')
  }

  if (process.env.NEXT_PUBLIC_BRAND_BACKGROUND_COLOR) {
    const isDark = isDarkColor(process.env.NEXT_PUBLIC_BRAND_BACKGROUND_COLOR)
    if (isDark) {
      cssVars.push(`--brand-is-dark: 1;`)
    }
  }

  return cssVars.length > 0 ? `:root { ${cssVars.join(' ')} }` : ''
}
