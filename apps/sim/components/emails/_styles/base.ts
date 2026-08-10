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
    /** De-emphasized text inside a body block — platform `--text-secondary` */
    textSecondary: '#525252',
    /** Muted text (labels, footer) — platform `--text-muted` */
    textMuted: '#7a7a7a',
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
 * Typography settings. Enforced against the platform sources by
 * `base.tokens.test.ts`.
 */
export const typography = {
  /**
   * Mirrors the platform face and its fallback chain
   * (`apps/sim/app/_styles/fonts/season/season.ts`). This matters more than the
   * `<Font>` webfont in `EmailLayout` — Gmail and Outlook strip `@font-face`
   * entirely, so for most recipients the fallback chain IS the rendered font.
   */
  fontFamily:
    "'Season Sans', system-ui, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif",
  /**
   * Deliberately brand-free, for emails that must read as typed by a person
   * (the plain founder notes, the agent's thread replies). Carries the same
   * non-brand fallbacks as {@link fontFamily} so Android and Linux clients land
   * on Roboto rather than a generic sans.
   */
  systemFontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  /**
   * `caption`/`base`/`md` are Sim's own scale from `tailwind.config.ts`. `sm` is
   * Tailwind's stock 14px — not a Sim token, but what `text-sm` resolves to in
   * `chipGeometryClass`, so the CTA has to use it.
   */
  fontSize: {
    caption: '12px',
    small: '13px',
    sm: '14px',
    base: '15px',
    /** Email body copy. Larger than the app's 15px `base` — the client default. */
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
  paragraphGap: 12,
}

/** Shared body-copy ramp. */
const bodyText = {
  fontSize: typography.fontSize.md,
  lineHeight: typography.lineHeight.body,
  color: colors.textBody,
  fontWeight: fontWeight.normal,
  fontFamily: typography.fontFamily,
}

/** Shared box geometry. */
const boxGeometry = {
  padding: '16px 18px',
  borderRadius: RADIUS,
  margin: '16px 0',
}

export const baseStyles = {
  /** Main body wrapper with outer background */
  main: {
    backgroundColor: colors.bgOuter,
    fontFamily: typography.fontFamily,
    padding: '32px 0',
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

  /** Standard paragraph text */
  paragraph: {
    ...bodyText,
    margin: `${spacing.paragraphGap}px 0`,
  },

  /**
   * The opening line of an email body — flush to the top, so it sits a fixed
   * distance below the logo instead of inheriting the paragraph gap.
   */
  greeting: {
    ...bodyText,
    margin: `0 0 ${spacing.paragraphGap}px 0`,
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

  /** Footer text style — used inside the footer's own centered table cells */
  footerText: {
    fontSize: typography.fontSize.caption,
    lineHeight: typography.lineHeight.caption,
    color: colors.textMuted,
    fontFamily: typography.fontFamily,
    margin: '0 0 10px 0',
  },

  /**
   * The closing fine-print line inside the card. Same ramp as
   * {@link footerText}, but left-aligned — the card is left-aligned while the
   * footer's own cells are not.
   */
  footnote: {
    fontSize: typography.fontSize.caption,
    lineHeight: typography.lineHeight.caption,
    color: colors.textMuted,
    fontFamily: typography.fontFamily,
    margin: '0 0 10px 0',
    textAlign: 'left' as const,
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

  /** Highlighted info box (e.g., "What you get with Pro") */
  infoBox: {
    ...boxGeometry,
    backgroundColor: colors.surfaceSubtle,
  },

  /** Error-state variant of {@link infoBox} */
  errorBox: {
    ...boxGeometry,
    backgroundColor: colors.errorBg,
    border: `1px solid ${colors.errorBorder}`,
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

  /**
   * Info box body copy.
   *
   * `margin: 0` — so multi-row content must be ONE `Text` with `<br />` between
   * rows, never several `Text` nodes, which would stack flush with no gap.
   */
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
}

/** Styles for plain personal emails (no branding, no EmailLayout). */
export const plainEmailStyles = {
  body: {
    fontFamily: typography.systemFontFamily,
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
