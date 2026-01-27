/**
 * Base styles for all email templates.
 * Colors are derived from globals.css light mode tokens.
 */

/** Color tokens from globals.css (light mode) */
export const colors = {
  /** Main canvas background */
  bgOuter: '#F7F9FC',
  /** Card/container background - pure white */
  bgCard: '#ffffff',
  /** Primary text color */
  textPrimary: '#2d2d2d',
  /** Secondary text color */
  textSecondary: '#404040',
  /** Tertiary text color */
  textTertiary: '#5c5c5c',
  /** Muted text (footer) */
  textMuted: '#737373',
  /** Brand primary - purple */
  brandPrimary: '#6f3dfa',
  /** Brand tertiary - green (matches Run/Deploy buttons) */
  brandTertiary: '#32bd7e',
  /** Border/divider color */
  divider: '#ededed',
  /** Footer background */
  footerBg: '#F7F9FC',
}

/** Typography settings */
export const typography = {
  fontFamily: "-apple-system, 'SF Pro Display', 'SF Pro Text', 'Helvetica', sans-serif",
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

  /** Main card container with rounded corners */
  container: {
    maxWidth: `${spacing.containerWidth}px`,
    margin: '0 auto',
    backgroundColor: colors.bgCard,
    borderRadius: '16px',
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

  /** Primary CTA button - matches app tertiary button style */
  button: {
    display: 'inline-block',
    backgroundColor: colors.brandTertiary,
    color: '#ffffff',
    fontWeight: 500,
    fontSize: '14px',
    padding: '6px 12px',
    borderRadius: '5px',
    textDecoration: 'none',
    textAlign: 'center' as const,
    margin: '4px 0',
    fontFamily: typography.fontFamily,
  },

  /** Link text style */
  link: {
    color: colors.brandTertiary,
    fontWeight: 'bold' as const,
    textDecoration: 'none',
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
    backgroundColor: '#f8f9fa',
    borderRadius: '6px',
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
    backgroundColor: colors.bgOuter,
    padding: '16px 18px',
    borderRadius: '6px',
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
