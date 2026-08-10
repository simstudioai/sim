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
    /** Canvas behind the card — platform `--surface-1` (the sidebar/panel surface) */
    bgOuter: '#fbfbfb',
    /** Card/container background — platform `--surface-2` */
    bgCard: '#ffffff',
    /** Headings and emphasis — platform `--text-primary` */
    textPrimary: '#1a1a1a',
    /** Body and value text — platform `--text-body` */
    textBody: '#434343',
    /** Secondary text — platform `--text-secondary` */
    textSecondary: '#525252',
    /** Tertiary text — platform `--text-tertiary` */
    textTertiary: '#5c5c5c',
    /** Muted text (labels, footer) — platform `--text-muted` */
    textMuted: '#7a7a7a',
    /** Brand primary — neutral by default, brand color when whitelabeled */
    brandPrimary:
      isWhitelabeled && brand.theme?.primaryColor ? brand.theme.primaryColor : '#1a1a1a',
    /** Accent for buttons and links — neutral by default, brand color when whitelabeled */
    brandTertiary: accentColor,
    /** Borders and dividers — platform `--border` */
    border: '#d8d8d8',
    /** Fill for info/code boxes on the white card — platform `--surface-3` */
    surfaceSubtle: '#f7f7f7',
    /** Error surface fill — platform `--terminal-status-error-bg` */
    errorBg: '#fef2f2',
    /** Error surface border — platform `--error-muted` */
    errorBorder: '#fecaca',
    /** Text on an inverse (dark) fill, e.g. the CTA — platform `--text-inverse` */
    textInverse: '#ffffff',
    /** Footer background — matches the canvas */
    footerBg: '#fbfbfb',
  }
}

export const colors = buildColors()

/**
 * Typography settings.
 *
 * `fontSize` mirrors the platform scale in `apps/sim/tailwind.config.ts` and uses
 * its names, so a value here is always traceable to a Tailwind token. Email body
 * copy runs at `md` (16px) rather than the app's 15px `base` — 16px is the email
 * client default and the only deviation, and it is still a real platform token.
 */
export const typography = {
  fontFamily:
    "'Season Sans', -apple-system, 'SF Pro Display', 'SF Pro Text', 'Helvetica', sans-serif",
  fontSize: {
    /** `text-caption` */
    caption: '12px',
    /** `text-small` */
    small: '13px',
    /** `text-sm` — chip/button label size */
    sm: '14px',
    /** `text-base` — the app's default body size */
    base: '15px',
    /** `text-md` — email body copy */
    md: '16px',
    /**
     * Display figure (OTP code, credit balance). Deliberately above the platform
     * scale — the app has no headline-numeral token because it has no surface
     * that needs one.
     */
    display: '24px',
  },
  lineHeight: {
    body: '24px',
    caption: '20px',
  },
}

/**
 * Weight scale. The platform allows exactly three steps (400/500/600) — never
 * `bold`, which resolves to 700 and sits off the scale.
 */
export const fontWeight = {
  normal: 400,
  medium: 500,
  semibold: 600,
} as const

/** Platform `--radius` (`rounded-lg`) — the single radius the design system uses. */
const RADIUS = '8px'

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
    border: `1px solid ${colors.border}`,
    borderRadius: RADIUS,
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

  /** Standard paragraph text — platform body copy (`--text-body`, normal weight) */
  paragraph: {
    fontSize: typography.fontSize.md,
    lineHeight: typography.lineHeight.body,
    color: colors.textBody,
    fontWeight: fontWeight.normal,
    fontFamily: typography.fontFamily,
    margin: `${spacing.paragraphGap}px 0`,
  },

  /**
   * The opening line of an email body. Identical to {@link paragraph} but flush
   * to the top, so it sits at a fixed distance below the logo instead of
   * inheriting the paragraph gap. Half the templates spelled this out inline and
   * half forgot it — always use the token.
   */
  greeting: {
    fontSize: typography.fontSize.md,
    lineHeight: typography.lineHeight.body,
    color: colors.textBody,
    fontWeight: fontWeight.normal,
    fontFamily: typography.fontFamily,
    margin: `0 0 ${spacing.paragraphGap}px 0`,
  },

  /** Inline emphasized label (e.g., "Platform:", "Time:") */
  label: {
    fontSize: typography.fontSize.md,
    lineHeight: typography.lineHeight.body,
    color: colors.textPrimary,
    fontWeight: fontWeight.semibold,
    fontFamily: typography.fontFamily,
    margin: 0,
    display: 'inline',
  },

  /**
   * Primary CTA — the platform's primary Chip, transcribed for email:
   * `chipPrimaryFillTokens` fill (`--text-primary`), `chipGeometryClass`
   * geometry (`h-[30px]`, `rounded-lg`, `px-2`, `text-sm`) at normal weight.
   */
  button: {
    display: 'inline-block',
    backgroundColor: colors.brandTertiary,
    color: colors.textInverse,
    fontWeight: fontWeight.normal,
    fontSize: typography.fontSize.sm,
    lineHeight: '30px',
    padding: '0 8px',
    borderRadius: RADIUS,
    textDecoration: 'none',
    textAlign: 'center' as const,
    margin: '4px 0',
    fontFamily: typography.fontFamily,
  },

  /** Link text style - neutral color, so it carries an underline to read as a link */
  link: {
    color: colors.brandTertiary,
    fontWeight: fontWeight.normal,
    textDecoration: 'underline',
  },

  /** Horizontal divider */
  divider: {
    borderTop: `1px solid ${colors.border}`,
    margin: `16px 0`,
  },

  /**
   * Footer link — muted rather than {@link link}'s accent, since the footer sits
   * outside the card and its links are secondary to the message.
   */
  footerLink: {
    color: colors.textMuted,
    fontWeight: fontWeight.normal,
    textDecoration: 'underline',
    fontFamily: typography.fontFamily,
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
    borderRadius: RADIUS,
    border: `1px solid ${colors.border}`,
    textAlign: 'center' as const,
  },

  /** Code/OTP text */
  code: {
    fontSize: typography.fontSize.display,
    fontWeight: fontWeight.semibold,
    letterSpacing: '3px',
    color: colors.textPrimary,
    fontFamily: typography.fontFamily,
    margin: 0,
  },

  /** Code block text (for JSON/code display) */
  codeBlock: {
    fontSize: typography.fontSize.caption,
    lineHeight: typography.lineHeight.caption,
    color: colors.textBody,
    fontFamily: 'monospace',
    whiteSpace: 'pre-wrap' as const,
    wordWrap: 'break-word' as const,
    margin: 0,
  },

  /** Highlighted info box (e.g., "What you get with Pro") */
  infoBox: {
    backgroundColor: colors.surfaceSubtle,
    padding: '16px 18px',
    borderRadius: RADIUS,
    margin: '16px 0',
  },

  /** Error-state variant of {@link infoBox} — same geometry, error fill and border */
  errorBox: {
    backgroundColor: colors.errorBg,
    border: `1px solid ${colors.errorBorder}`,
    padding: '16px 18px',
    borderRadius: RADIUS,
    margin: '16px 0',
  },

  /** Info box title */
  infoBoxTitle: {
    fontSize: typography.fontSize.md,
    lineHeight: typography.lineHeight.body,
    fontWeight: fontWeight.semibold,
    color: colors.textPrimary,
    fontFamily: typography.fontFamily,
    margin: '0 0 8px 0',
  },

  /** Info box list content */
  infoBoxList: {
    fontSize: typography.fontSize.md,
    lineHeight: '1.6',
    color: colors.textBody,
    fontFamily: typography.fontFamily,
    margin: 0,
  },

  /** Muted caption inside an info box, above a {@link infoBoxValue} figure */
  infoBoxLabel: {
    fontSize: typography.fontSize.sm,
    lineHeight: typography.lineHeight.caption,
    color: colors.textMuted,
    fontWeight: fontWeight.normal,
    fontFamily: typography.fontFamily,
    margin: 0,
  },

  /** The headline figure of a stat info box (e.g. a credit balance) */
  infoBoxValue: {
    fontSize: typography.fontSize.display,
    lineHeight: '32px',
    fontWeight: fontWeight.semibold,
    color: colors.textPrimary,
    fontFamily: typography.fontFamily,
    margin: '4px 0 0 0',
  },

  /** Section borders - decorative accent line */
  sectionsBorders: {
    width: '100%',
    display: 'flex',
  },

  sectionBorder: {
    borderBottom: `1px solid ${colors.border}`,
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
    fontSize: typography.fontSize.md,
    lineHeight: typography.lineHeight.body,
    color: colors.textBody,
    fontFamily: typography.fontFamily,
    margin: '8px 0',
  },
}

/**
 * Styles for plain personal emails (no branding, no EmailLayout).
 *
 * The system font stack is deliberate — these read as a message typed by a
 * person, so they must NOT carry the brand face. Everything else still resolves
 * through the shared tokens.
 */
export const plainEmailStyles = {
  body: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    backgroundColor: colors.bgCard,
    margin: '0',
    padding: '0',
  },
  container: {
    maxWidth: '560px',
    margin: '40px auto',
    padding: '0 24px',
  },
  p: {
    fontSize: typography.fontSize.base,
    lineHeight: '1.6',
    color: colors.textPrimary,
    margin: '0 0 16px',
  },
} as const
