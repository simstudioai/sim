import { vi } from 'vitest'

const BRAND_NAME = 'Sim'

const colors = {
  bgOuter: '#fbfbfb',
  bgCard: '#ffffff',
  textPrimary: '#1a1a1a',
  textBody: '#434343',
  textSecondary: '#525252',
  textMuted: '#7a7a7a',
  brandTertiary: '#1a1a1a',
  border: '#d8d8d8',
  surfaceSubtle: '#f7f7f7',
  errorBg: '#fef2f2',
  errorBorder: '#fecaca',
  textInverse: '#ffffff',
  footerBg: '#fbfbfb',
}

const typography = {
  fontFamily:
    "'Season Sans', system-ui, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif",
  systemFontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  fontSize: {
    caption: '12px',
    small: '13px',
    sm: '14px',
    base: '15px',
    md: '16px',
    display: '24px',
  },
  lineHeight: {
    body: '24px',
    caption: '20px',
  },
}
const fontWeight = {
  normal: 400,
  medium: 500,
  semibold: 600,
} as const
const RADIUS = '8px'
const spacing = {
  containerWidth: 600,
  gutter: 40,
  paragraphGap: 12,
}
const bodyText = {
  fontSize: typography.fontSize.md,
  lineHeight: typography.lineHeight.body,
  color: colors.textBody,
  fontWeight: fontWeight.normal,
  fontFamily: typography.fontFamily,
}
const boxGeometry = {
  padding: '16px 18px',
  borderRadius: RADIUS,
  margin: '16px 0',
}

const baseStyles = {
  main: {
    backgroundColor: colors.bgOuter,
    fontFamily: typography.fontFamily,
    padding: '32px 0',
  },
  container: {
    maxWidth: `${spacing.containerWidth}px`,
    margin: '0 auto',
    backgroundColor: colors.bgCard,
    border: `1px solid ${colors.border}`,
    borderRadius: RADIUS,
    overflow: 'hidden',
  },
  header: {
    padding: `32px ${spacing.gutter}px 16px ${spacing.gutter}px`,
    textAlign: 'left' as const,
  },
  content: {
    padding: `0 ${spacing.gutter}px 32px ${spacing.gutter}px`,
  },
  paragraph: {
    ...bodyText,
    margin: `${spacing.paragraphGap}px 0`,
  },
  greeting: {
    ...bodyText,
    margin: `0 0 ${spacing.paragraphGap}px 0`,
  },
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
  link: {
    color: colors.brandTertiary,
    fontWeight: fontWeight.normal,
    textDecoration: 'underline',
  },
  divider: {
    borderTop: `1px solid ${colors.border}`,
    margin: `16px 0`,
  },
  footerLink: {
    color: colors.textMuted,
    fontWeight: fontWeight.normal,
    textDecoration: 'underline',
    fontFamily: typography.fontFamily,
  },
  footerText: {
    fontSize: typography.fontSize.caption,
    lineHeight: typography.lineHeight.caption,
    color: colors.textMuted,
    fontFamily: typography.fontFamily,
    margin: '0 0 10px 0',
  },
  footnote: {
    fontSize: typography.fontSize.caption,
    lineHeight: typography.lineHeight.caption,
    color: colors.textMuted,
    fontFamily: typography.fontFamily,
    margin: '0 0 10px 0',
    textAlign: 'left' as const,
  },
  codeContainer: {
    margin: '12px 0',
    padding: '12px 16px',
    backgroundColor: colors.surfaceSubtle,
    borderRadius: RADIUS,
    border: `1px solid ${colors.border}`,
    textAlign: 'center' as const,
  },
  code: {
    fontSize: typography.fontSize.display,
    fontWeight: fontWeight.semibold,
    letterSpacing: '3px',
    color: colors.textPrimary,
    fontFamily: typography.fontFamily,
    margin: 0,
  },
  infoBox: {
    ...boxGeometry,
    backgroundColor: colors.surfaceSubtle,
  },
  errorBox: {
    ...boxGeometry,
    backgroundColor: colors.errorBg,
    border: `1px solid ${colors.errorBorder}`,
  },
  infoBoxTitle: {
    fontSize: typography.fontSize.md,
    lineHeight: typography.lineHeight.body,
    fontWeight: fontWeight.semibold,
    color: colors.textPrimary,
    fontFamily: typography.fontFamily,
    margin: '0 0 8px 0',
  },
  infoBoxList: {
    fontSize: typography.fontSize.md,
    lineHeight: '1.6',
    color: colors.textBody,
    fontFamily: typography.fontFamily,
    margin: 0,
  },
  infoBoxLabel: {
    fontSize: typography.fontSize.sm,
    lineHeight: typography.lineHeight.caption,
    color: colors.textMuted,
    fontWeight: fontWeight.normal,
    fontFamily: typography.fontFamily,
    margin: 0,
  },
  infoBoxValue: {
    fontSize: typography.fontSize.display,
    lineHeight: '32px',
    fontWeight: fontWeight.semibold,
    color: colors.textPrimary,
    fontFamily: typography.fontFamily,
    margin: '4px 0 0 0',
  },
  spacer: {
    border: 0,
    margin: 0,
    padding: 0,
    fontSize: '1px',
    lineHeight: '1px',
  },
  gutter: {
    border: 0,
    margin: 0,
    padding: 0,
    fontSize: '1px',
    lineHeight: '1px',
    width: `${spacing.gutter}px`,
  },
}
const plainEmailStyles = {
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

const LIMIT_SUBJECTS: Record<string, { warningSubject: string; reachedSubject: string }> = {
  credits: {
    warningSubject: "You're nearing your usage limit",
    reachedSubject: "You've reached your usage limit",
  },
  storage: {
    warningSubject: "You're running low on storage",
    reachedSubject: "You've reached your storage limit",
  },
  tables: {
    warningSubject: "You're running low on table space",
    reachedSubject: "You've reached your table limit",
  },
  seats: {
    warningSubject: "You're running low on seats",
    reachedSubject: "You've used all your seats",
  },
}

const EMAIL_SUBJECTS: Record<string, string> = {
  'sign-in': `Sign in to ${BRAND_NAME}`,
  'email-verification': `Verify your email for ${BRAND_NAME}`,
  'change-email': `Verify your new email for ${BRAND_NAME}`,
  'forget-password': `Reset your ${BRAND_NAME} password`,
  'reset-password': `Reset your ${BRAND_NAME} password`,
  'existing-account': `Sign-up attempt with your ${BRAND_NAME} email`,
  invitation: `You've been invited to join a team on ${BRAND_NAME}`,
  'enterprise-owner-invitation': `Activate your Enterprise organization on ${BRAND_NAME}`,
  'batch-invitation': `You've been invited to join a team and workspaces on ${BRAND_NAME}`,
  'workspace-added': `You've been added to a workspace on ${BRAND_NAME}`,
  'permission-access-request-created': `An access request needs review on ${BRAND_NAME}`,
  'permission-access-request-decided': `Your access request was updated on ${BRAND_NAME}`,
  'enterprise-subscription': `Your Enterprise Plan is now active on ${BRAND_NAME}`,
  'usage-threshold': `You're nearing your monthly budget on ${BRAND_NAME}`,
  'free-tier-upgrade': `You're at 80% of your free credits on ${BRAND_NAME}`,
  'payment-failed': `Payment failed on ${BRAND_NAME} — action required`,
  'credit-purchase': `Credits added to your ${BRAND_NAME} account`,
  'abandoned-checkout': 'Quick question',
  'free-tier-exhausted': `You've run out of free credits on ${BRAND_NAME}`,
  'schedule-disabled': `A schedule was turned off on ${BRAND_NAME}`,
  'subprocessor-change': `Upcoming change to ${BRAND_NAME} sub-processors`,
  'onboarding-followup': `Quick question about ${BRAND_NAME}`,
  welcome: `Welcome to ${BRAND_NAME}`,
}

/**
 * Controllable mock functions for `@/components/emails`.
 *
 * - Every `render*Email` is a bare `vi.fn()` (returns `undefined`); set the rendered HTML per test.
 * - Every email/layout component is `vi.fn(() => null)`.
 * - The subject helpers port the real logic with the default brand name `Sim` (no whitelabeling):
 *   `mockGetEmailSubject`, `mockGetLimitEmailSubject`, `mockGetPlanWelcomeSubject`,
 *   `mockGetRequestConfirmationSubject`, `mockGetOtpSubject`,
 *   `mockGetCredentialGroupInvitationSubject`.
 *
 * @example
 * ```ts
 * import { emailTemplatesMockFns } from '@sim/testing/mocks/email-templates.mock'
 *
 * emailTemplatesMockFns.mockRenderOTPEmail.mockResolvedValue('<html>123456</html>')
 * ```
 */
export const emailTemplatesMockFns = {
  mockExistingAccountEmail: vi.fn((_props?: unknown): null => null),
  mockOnboardingFollowupEmail: vi.fn((_props?: unknown): null => null),
  mockOTPVerificationEmail: vi.fn((_props?: unknown): null => null),
  mockResetPasswordEmail: vi.fn((_props?: unknown): null => null),
  mockWelcomeEmail: vi.fn((_props?: unknown): null => null),
  mockAbandonedCheckoutEmail: vi.fn((_props?: unknown): null => null),
  mockCreditPurchaseEmail: vi.fn((_props?: unknown): null => null),
  mockCreditsExhaustedEmail: vi.fn((_props?: unknown): null => null),
  mockEnterpriseSubscriptionEmail: vi.fn((_props?: unknown): null => null),
  mockFreeTierUpgradeEmail: vi.fn((_props?: unknown): null => null),
  mockLimitThresholdEmail: vi.fn((_props?: unknown): null => null),
  mockPaymentFailedEmail: vi.fn((_props?: unknown): null => null),
  mockPlanWelcomeEmail: vi.fn((_props?: unknown): null => null),
  mockUsageLimitReachedEmail: vi.fn((_props?: unknown): null => null),
  mockUsageThresholdEmail: vi.fn((_props?: unknown): null => null),
  mockEmailButton: vi.fn((_props?: unknown): null => null),
  mockEmailFooter: vi.fn((_props?: unknown): null => null),
  mockEmailLayout: vi.fn((_props?: unknown): null => null),
  mockEmailStrong: vi.fn((_props?: unknown): null => null),
  mockBatchInvitationEmail: vi.fn((_props?: unknown): null => null),
  mockEnterpriseOwnerInvitationEmail: vi.fn((_props?: unknown): null => null),
  mockInvitationEmail: vi.fn((_props?: unknown): null => null),
  mockWorkspaceAddedEmail: vi.fn((_props?: unknown): null => null),
  mockWorkspaceInvitationEmail: vi.fn((_props?: unknown): null => null),
  mockPermissionAccessRequestEmail: vi.fn((_props?: unknown): null => null),
  mockScheduleDisabledEmail: vi.fn((_props?: unknown): null => null),
  mockSubprocessorChangeEmail: vi.fn((_props?: unknown): null => null),
  mockHelpConfirmationEmail: vi.fn((_props?: unknown): null => null),
  mockRenderOTPEmail: vi.fn(),
  mockRenderExistingAccountEmail: vi.fn(),
  mockRenderPasswordResetEmail: vi.fn(),
  mockRenderInvitationEmail: vi.fn(),
  mockRenderBatchInvitationEmail: vi.fn(),
  mockRenderEnterpriseOwnerInvitationEmail: vi.fn(),
  mockRenderHelpConfirmationEmail: vi.fn(),
  mockRenderEnterpriseSubscriptionEmail: vi.fn(),
  mockRenderUsageThresholdEmail: vi.fn(),
  mockRenderUsageLimitReachedEmail: vi.fn(),
  mockRenderPermissionAccessRequestEmail: vi.fn(),
  mockRenderScheduleDisabledEmail: vi.fn(),
  mockRenderSubprocessorChangeEmail: vi.fn(),
  mockRenderFreeTierUpgradeEmail: vi.fn(),
  mockRenderLimitThresholdEmail: vi.fn(),
  mockRenderPlanWelcomeEmail: vi.fn(),
  mockRenderWelcomeEmail: vi.fn(),
  mockRenderOnboardingFollowupEmail: vi.fn(),
  mockRenderAbandonedCheckoutEmail: vi.fn(),
  mockRenderCreditsExhaustedEmail: vi.fn(),
  mockRenderCreditPurchaseEmail: vi.fn(),
  mockRenderWorkspaceInvitationEmail: vi.fn(),
  mockRenderWorkspaceAddedEmail: vi.fn(),
  mockRenderPaymentFailedEmail: vi.fn(),
  mockRenderInboxResponseEmail: vi.fn(),
  mockRenderInboxErrorEmail: vi.fn(),
  mockGetEmailSubject: vi.fn((type: string): string => EMAIL_SUBJECTS[type] ?? BRAND_NAME),
  mockGetLimitEmailSubject: vi.fn((reason: string, kind: 'warning' | 'reached'): string => {
    const copy = LIMIT_SUBJECTS[reason]
    const subject = kind === 'reached' ? copy.reachedSubject : copy.warningSubject
    return `${subject} on ${BRAND_NAME}`
  }),
  mockGetPlanWelcomeSubject: vi.fn(
    (planDisplayName: string): string =>
      `Your ${planDisplayName} plan is now active on ${BRAND_NAME}`
  ),
  mockGetRequestConfirmationSubject: vi.fn((userSubject: string, requestType?: string): string =>
    requestType
      ? `Your ${requestType} request has been received: ${userSubject}`
      : `We've received your message: ${userSubject}`
  ),
  mockGetOtpSubject: vi.fn(
    (resourceLabel: string): string => `Verification code for ${resourceLabel}`
  ),
  mockGetCredentialGroupInvitationSubject: vi.fn(
    (inviterName: string | undefined, workspaceName: string): string =>
      inviterName
        ? `${inviterName} invited you to connect accounts for ${workspaceName} on ${BRAND_NAME}`
        : `You have been invited to connect accounts for ${workspaceName} on ${BRAND_NAME}`
  ),
}

/**
 * Static mock module for `@/components/emails`. The style tokens (`baseStyles`, `colors`,
 * `fontWeight`, `plainEmailStyles`, `spacing`, `typography`) carry the real non-whitelabeled
 * values.
 *
 * @example
 * ```ts
 * vi.mock('@/components/emails', () => emailTemplatesMock)
 * ```
 */
export const emailTemplatesMock = {
  baseStyles,
  colors,
  fontWeight,
  plainEmailStyles,
  spacing,
  typography,
  ExistingAccountEmail: emailTemplatesMockFns.mockExistingAccountEmail,
  OnboardingFollowupEmail: emailTemplatesMockFns.mockOnboardingFollowupEmail,
  OTPVerificationEmail: emailTemplatesMockFns.mockOTPVerificationEmail,
  ResetPasswordEmail: emailTemplatesMockFns.mockResetPasswordEmail,
  WelcomeEmail: emailTemplatesMockFns.mockWelcomeEmail,
  AbandonedCheckoutEmail: emailTemplatesMockFns.mockAbandonedCheckoutEmail,
  CreditPurchaseEmail: emailTemplatesMockFns.mockCreditPurchaseEmail,
  CreditsExhaustedEmail: emailTemplatesMockFns.mockCreditsExhaustedEmail,
  EnterpriseSubscriptionEmail: emailTemplatesMockFns.mockEnterpriseSubscriptionEmail,
  FreeTierUpgradeEmail: emailTemplatesMockFns.mockFreeTierUpgradeEmail,
  LimitThresholdEmail: emailTemplatesMockFns.mockLimitThresholdEmail,
  PaymentFailedEmail: emailTemplatesMockFns.mockPaymentFailedEmail,
  PlanWelcomeEmail: emailTemplatesMockFns.mockPlanWelcomeEmail,
  UsageLimitReachedEmail: emailTemplatesMockFns.mockUsageLimitReachedEmail,
  UsageThresholdEmail: emailTemplatesMockFns.mockUsageThresholdEmail,
  EmailButton: emailTemplatesMockFns.mockEmailButton,
  EmailFooter: emailTemplatesMockFns.mockEmailFooter,
  EmailLayout: emailTemplatesMockFns.mockEmailLayout,
  EmailStrong: emailTemplatesMockFns.mockEmailStrong,
  BatchInvitationEmail: emailTemplatesMockFns.mockBatchInvitationEmail,
  EnterpriseOwnerInvitationEmail: emailTemplatesMockFns.mockEnterpriseOwnerInvitationEmail,
  InvitationEmail: emailTemplatesMockFns.mockInvitationEmail,
  WorkspaceAddedEmail: emailTemplatesMockFns.mockWorkspaceAddedEmail,
  WorkspaceInvitationEmail: emailTemplatesMockFns.mockWorkspaceInvitationEmail,
  PermissionAccessRequestEmail: emailTemplatesMockFns.mockPermissionAccessRequestEmail,
  ScheduleDisabledEmail: emailTemplatesMockFns.mockScheduleDisabledEmail,
  SubprocessorChangeEmail: emailTemplatesMockFns.mockSubprocessorChangeEmail,
  HelpConfirmationEmail: emailTemplatesMockFns.mockHelpConfirmationEmail,
  renderOTPEmail: emailTemplatesMockFns.mockRenderOTPEmail,
  renderExistingAccountEmail: emailTemplatesMockFns.mockRenderExistingAccountEmail,
  renderPasswordResetEmail: emailTemplatesMockFns.mockRenderPasswordResetEmail,
  renderInvitationEmail: emailTemplatesMockFns.mockRenderInvitationEmail,
  renderBatchInvitationEmail: emailTemplatesMockFns.mockRenderBatchInvitationEmail,
  renderEnterpriseOwnerInvitationEmail:
    emailTemplatesMockFns.mockRenderEnterpriseOwnerInvitationEmail,
  renderHelpConfirmationEmail: emailTemplatesMockFns.mockRenderHelpConfirmationEmail,
  renderEnterpriseSubscriptionEmail: emailTemplatesMockFns.mockRenderEnterpriseSubscriptionEmail,
  renderUsageThresholdEmail: emailTemplatesMockFns.mockRenderUsageThresholdEmail,
  renderUsageLimitReachedEmail: emailTemplatesMockFns.mockRenderUsageLimitReachedEmail,
  renderPermissionAccessRequestEmail: emailTemplatesMockFns.mockRenderPermissionAccessRequestEmail,
  renderScheduleDisabledEmail: emailTemplatesMockFns.mockRenderScheduleDisabledEmail,
  renderSubprocessorChangeEmail: emailTemplatesMockFns.mockRenderSubprocessorChangeEmail,
  renderFreeTierUpgradeEmail: emailTemplatesMockFns.mockRenderFreeTierUpgradeEmail,
  renderLimitThresholdEmail: emailTemplatesMockFns.mockRenderLimitThresholdEmail,
  renderPlanWelcomeEmail: emailTemplatesMockFns.mockRenderPlanWelcomeEmail,
  renderWelcomeEmail: emailTemplatesMockFns.mockRenderWelcomeEmail,
  renderOnboardingFollowupEmail: emailTemplatesMockFns.mockRenderOnboardingFollowupEmail,
  renderAbandonedCheckoutEmail: emailTemplatesMockFns.mockRenderAbandonedCheckoutEmail,
  renderCreditsExhaustedEmail: emailTemplatesMockFns.mockRenderCreditsExhaustedEmail,
  renderCreditPurchaseEmail: emailTemplatesMockFns.mockRenderCreditPurchaseEmail,
  renderWorkspaceInvitationEmail: emailTemplatesMockFns.mockRenderWorkspaceInvitationEmail,
  renderWorkspaceAddedEmail: emailTemplatesMockFns.mockRenderWorkspaceAddedEmail,
  renderPaymentFailedEmail: emailTemplatesMockFns.mockRenderPaymentFailedEmail,
  renderInboxResponseEmail: emailTemplatesMockFns.mockRenderInboxResponseEmail,
  renderInboxErrorEmail: emailTemplatesMockFns.mockRenderInboxErrorEmail,
  getEmailSubject: emailTemplatesMockFns.mockGetEmailSubject,
  getLimitEmailSubject: emailTemplatesMockFns.mockGetLimitEmailSubject,
  getPlanWelcomeSubject: emailTemplatesMockFns.mockGetPlanWelcomeSubject,
  getRequestConfirmationSubject: emailTemplatesMockFns.mockGetRequestConfirmationSubject,
  getOtpSubject: emailTemplatesMockFns.mockGetOtpSubject,
  getCredentialGroupInvitationSubject:
    emailTemplatesMockFns.mockGetCredentialGroupInvitationSubject,
}
