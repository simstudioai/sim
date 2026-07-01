/**
 * Base styles for all email templates.
 * Colors are derived from globals.css light mode tokens.
 */

import { getBrandConfig } from '@/ee/whitelabeling'

/** Color tokens from globals.css (light mode), brand-aware for whitelabeled instances */
function buildColors() {
  const brand = getBrandConfig()
  const isWhitelabeled = brand.isWhitelabeled
  const accentColor =
    isWhitelabeled && brand.theme?.primaryColor ? brand.theme.primaryColor : '#1a1a1a'

  return {
    /** Main canvas background — a hair off-white so the white card reads via contrast, not the border alone */
    bgOuter: '#f8f8f8',
    /** Card/container background — platform `--surface-2` */
    bgCard: '#ffffff',
    /** Primary text — platform `--text-primary` */
    textPrimary: '#1a1a1a',
    /** Secondary text — platform `--text-secondary` */
    textSecondary: '#525252',
    /** Tertiary text — platform `--text-tertiary` */
    textTertiary: '#5c5c5c',
    /** Muted text (footer) — platform `--text-muted` */
    textMuted: '#707070',
    /** Brand primary — neutral by default, brand color when whitelabeled */
    brandPrimary:
      isWhitelabeled && brand.theme?.primaryColor ? brand.theme.primaryColor : '#1a1a1a',
    /** Accent for buttons and links — neutral by default, brand color when whitelabeled */
    brandTertiary: accentColor,
    /** Border/divider — platform `--border` */
    divider: '#dedede',
    /** Subtle fill for info/code boxes on the white card */
    surfaceSubtle: '#f7f7f7',
    /** Error surface fill — platform `--terminal-status-error-bg` */
    errorBg: '#fef2f2',
    /** Error surface border — platform `--error-muted` */
    errorBorder: '#fecaca',
    /** Footer background — matches the canvas */
    footerBg: '#f8f8f8',
  }
}

export const colors = buildColors()

/** Typography settings */
export const typography = {
  fontFamily:
    "'Season Sans', -apple-system, 'SF Pro Display', 'SF Pro Text', 'Helvetica', sans-serif",
  fontSize: {
    body: '16px',
    small: '14px',
    caption: '12px',
  },
  lineHeight: {
    body: '24px',
    caption: '20px',
  },
}

/** Spacing values */
export const spacing = {
  containerWidth: 600,
  gutter: 40,
  sectionGap: 20,
  paragraphGap: 12,
  /** Logo width in pixels */
  logoWidth: 90,
}

export const baseStyles = {
  fontFamily: typography.fontFamily,

  /** Main body wrapper with outer background */
  main: {
    backgroundColor: colors.bgOuter,
    fontFamily: typography.fontFamily,
    padding: '32px 0',
  },

  /** Center wrapper for email content */
  wrapper: {
    maxWidth: `${spacing.containerWidth}px`,
    margin: '0 auto',
  },

  /** Main card container — white surface, chip-radius, hairline border on the near-white canvas */
  container: {
    maxWidth: `${spacing.containerWidth}px`,
    margin: '0 auto',
    backgroundColor: colors.bgCard,
    border: `1px solid ${colors.divider}`,
    borderRadius: '8px',
    overflow: 'hidden',
  },

  /** Header section with logo */
  header: {
    padding: `32px ${spacing.gutter}px 16px ${spacing.gutter}px`,
    textAlign: 'left' as const,
  },

  /** Main content area with horizontal padding */
  content: {
    padding: `0 ${spacing.gutter}px 32px ${spacing.gutter}px`,
  },

  /** Standard paragraph text */
  paragraph: {
    fontSize: typography.fontSize.body,
    lineHeight: typography.lineHeight.body,
    color: colors.textSecondary,
    fontWeight: 400,
    fontFamily: typography.fontFamily,
    margin: `${spacing.paragraphGap}px 0`,
  },

  /** Bold label text (e.g., "Platform:", "Time:") */
  label: {
    fontSize: typography.fontSize.body,
    lineHeight: typography.lineHeight.body,
    color: colors.textSecondary,
    fontWeight: 'bold' as const,
    fontFamily: typography.fontFamily,
    margin: 0,
    display: 'inline',
  },

  /** Primary CTA button - matches the platform's primary Chip (inverse fill, rounded-lg, h-30, text-sm) */
  button: {
    display: 'inline-block',
    backgroundColor: colors.brandTertiary,
    color: '#ffffff',
    fontWeight: 400,
    fontSize: '14px',
    lineHeight: '30px',
    padding: '0 12px',
    borderRadius: '8px',
    textDecoration: 'none',
    textAlign: 'center' as const,
    margin: '4px 0',
    fontFamily: typography.fontFamily,
  },

  /** Link text style - neutral color, so it carries an underline to read as a link */
  link: {
    color: colors.brandTertiary,
    fontWeight: 400,
    textDecoration: 'underline',
  },

  /** Horizontal divider */
  divider: {
    borderTop: `1px solid ${colors.divider}`,
    margin: `16px 0`,
  },

  /** Footer container (inside gray area below card) */
  footer: {
    maxWidth: `${spacing.containerWidth}px`,
    margin: '0 auto',
    padding: `32px ${spacing.gutter}px`,
    textAlign: 'left' as const,
  },

  /** Footer text style */
  footerText: {
    fontSize: typography.fontSize.caption,
    lineHeight: typography.lineHeight.caption,
    color: colors.textMuted,
    fontFamily: typography.fontFamily,
    margin: '0 0 10px 0',
  },

  /** Code/OTP container */
  codeContainer: {
    margin: '12px 0',
    padding: '12px 16px',
    backgroundColor: colors.surfaceSubtle,
    borderRadius: '8px',
    border: `1px solid ${colors.divider}`,
    textAlign: 'center' as const,
  },

  /** Code/OTP text */
  code: {
    fontSize: '24px',
    fontWeight: 'bold' as const,
    letterSpacing: '3px',
    color: colors.textPrimary,
    fontFamily: typography.fontFamily,
    margin: 0,
  },

  /** Code block text (for JSON/code display) */
  codeBlock: {
    fontSize: typography.fontSize.caption,
    lineHeight: typography.lineHeight.caption,
    color: colors.textSecondary,
    fontFamily: 'monospace',
    whiteSpace: 'pre-wrap' as const,
    wordWrap: 'break-word' as const,
    margin: 0,
  },

  /** Highlighted info box (e.g., "What you get with Pro") */
  infoBox: {
    backgroundColor: colors.surfaceSubtle,
    padding: '16px 18px',
    borderRadius: '8px',
    margin: '16px 0',
  },

  /** Info box title */
  infoBoxTitle: {
    fontSize: typography.fontSize.body,
    lineHeight: typography.lineHeight.body,
    fontWeight: 600,
    color: colors.textPrimary,
    fontFamily: typography.fontFamily,
    margin: '0 0 8px 0',
  },

  /** Info box list content */
  infoBoxList: {
    fontSize: typography.fontSize.body,
    lineHeight: '1.6',
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    margin: 0,
  },

  /** Section borders - decorative accent line */
  sectionsBorders: {
    width: '100%',
    display: 'flex',
  },

  sectionBorder: {
    borderBottom: `1px solid ${colors.divider}`,
    width: '249px',
  },

  sectionCenter: {
    borderBottom: `1px solid ${colors.brandTertiary}`,
    width: '102px',
  },

  /** Spacer row for vertical spacing in tables */
  spacer: {
    border: 0,
    margin: 0,
    padding: 0,
    fontSize: '1px',
    lineHeight: '1px',
  },

  /** Gutter cell for horizontal padding in tables */
  gutter: {
    border: 0,
    margin: 0,
    padding: 0,
    fontSize: '1px',
    lineHeight: '1px',
    width: `${spacing.gutter}px`,
  },

  /** Info row (e.g., Platform, Device location, Time) */
  infoRow: {
    fontSize: typography.fontSize.body,
    lineHeight: typography.lineHeight.body,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    margin: '8px 0',
  },
}

/** Styles for plain personal emails (no branding, no EmailLayout) */
export const plainEmailStyles = {
  body: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    backgroundColor: '#ffffff',
    margin: '0',
    padding: '0',
  },
  container: {
    maxWidth: '560px',
    margin: '40px auto',
    padding: '0 24px',
  },
  p: {
    fontSize: '15px',
    lineHeight: '1.6',
    color: '#1a1a1a',
    margin: '0 0 16px',
  },
} as const
