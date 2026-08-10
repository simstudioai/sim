import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import {
  renderAbandonedCheckoutEmail,
  renderBatchInvitationEmail,
  renderCreditPurchaseEmail,
  renderCreditsExhaustedEmail,
  renderEnterpriseSubscriptionEmail,
  renderExistingAccountEmail,
  renderFreeTierUpgradeEmail,
  renderHelpConfirmationEmail,
  renderInvitationEmail,
  renderLimitThresholdEmail,
  renderOnboardingFollowupEmail,
  renderOTPEmail,
  renderPasswordResetEmail,
  renderPaymentFailedEmail,
  renderPlanWelcomeEmail,
  renderScheduleDisabledEmail,
  renderUsageLimitReachedEmail,
  renderUsageThresholdEmail,
  renderWelcomeEmail,
  renderWorkspaceAddedEmail,
  renderWorkspaceInvitationEmail,
} from '@/components/emails'
import { colors, typography } from '@/components/emails/_styles'
import { emailPreviewQuerySchema } from '@/lib/api/contracts/common'
import { validationErrorResponse } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const emailTemplates = {
  // Auth emails
  otp: () => renderOTPEmail('123456', 'user@example.com', 'email-verification'),
  'otp-sign-in': () => renderOTPEmail('123456', 'user@example.com', 'sign-in'),
  'reset-password': () => renderPasswordResetEmail('John', 'https://sim.ai/reset?token=abc123'),
  'existing-account': () => renderExistingAccountEmail('John'),
  welcome: () => renderWelcomeEmail('John'),
  'onboarding-followup': () => renderOnboardingFollowupEmail('John'),

  // Invitation emails
  invitation: () => renderInvitationEmail('Jane Doe', 'Acme Corp', 'https://sim.ai/invite/abc123'),
  'workspace-added': () =>
    renderWorkspaceAddedEmail('Jane Doe', 'Engineering', 'https://sim.ai/workspace/ws_123'),
  'batch-invitation': () =>
    renderBatchInvitationEmail(
      'Jane Doe',
      'Acme Corp',
      'admin',
      [
        { workspaceId: 'ws_123', workspaceName: 'Engineering', permission: 'write' },
        { workspaceId: 'ws_456', workspaceName: 'Design', permission: 'read' },
      ],
      'https://sim.ai/invite/abc123'
    ),
  'workspace-invitation': () =>
    renderWorkspaceInvitationEmail(
      'John Smith',
      ['Engineering Team'],
      'https://sim.ai/workspace/invite/abc123'
    ),

  // Support emails
  'help-confirmation': () => renderHelpConfirmationEmail('feature_request', 2),

  // Billing emails
  'usage-threshold': () =>
    renderUsageThresholdEmail({
      userName: 'John',
      planName: 'Pro',
      percentUsed: 75,
      currentUsage: 15,
      limit: 20,
      ctaLink: 'https://sim.ai/settings/billing',
    }),
  'enterprise-subscription': () => renderEnterpriseSubscriptionEmail('John'),
  'free-tier-upgrade': () =>
    renderFreeTierUpgradeEmail({
      userName: 'John',
      percentUsed: 90,
      currentUsage: 9,
      limit: 10,
      upgradeLink: 'https://sim.ai/settings/billing',
    }),
  'plan-welcome-pro': () =>
    renderPlanWelcomeEmail({
      planName: 'Pro',
      userName: 'John',
      loginLink: 'https://sim.ai/login',
    }),
  'plan-welcome-team': () =>
    renderPlanWelcomeEmail({
      planName: 'Team',
      userName: 'John',
      loginLink: 'https://sim.ai/login',
    }),
  'credit-purchase': () =>
    renderCreditPurchaseEmail({
      userName: 'John',
      amount: 50,
      newBalance: 75,
    }),
  'credits-exhausted': () =>
    renderCreditsExhaustedEmail({
      userName: 'John',
      limit: 10,
      upgradeLink: 'https://sim.ai/settings/billing',
    }),
  'abandoned-checkout': () => renderAbandonedCheckoutEmail('John'),
  'limit-threshold-storage-warning': () =>
    renderLimitThresholdEmail({
      kind: 'warning',
      reason: 'storage',
      userName: 'John',
      usageLabel: '4.2 GB',
      limitLabel: '5 GB',
      percentUsed: 84,
      upgradeLink: 'https://sim.ai/settings/billing',
    }),
  'limit-threshold-tables-reached': () =>
    renderLimitThresholdEmail({
      kind: 'reached',
      reason: 'tables',
      userName: 'John',
      usageLabel: '50,000 rows',
      limitLabel: '50,000 rows',
      percentUsed: 100,
      upgradeLink: 'https://sim.ai/settings/billing',
    }),
  'limit-threshold-seats-reached': () =>
    renderLimitThresholdEmail({
      kind: 'reached',
      reason: 'seats',
      userName: 'John',
      usageLabel: '10 seats',
      limitLabel: '10 seats',
      percentUsed: 100,
      upgradeLink: 'https://sim.ai/settings/billing',
    }),
  'payment-failed': () =>
    renderPaymentFailedEmail({
      userName: 'John',
      amountDue: 20,
      lastFourDigits: '4242',
      billingPortalUrl: 'https://sim.ai/settings/billing',
      failureReason: 'Card declined',
    }),
  'usage-limit-reached': () =>
    renderUsageLimitReachedEmail({
      userName: 'John',
      planName: 'Pro',
      scope: 'user',
      currentUsage: 20,
      limit: 20,
      ctaLink: 'https://sim.ai/settings/billing',
    }),
  'usage-limit-reached-org': () =>
    renderUsageLimitReachedEmail({
      userName: 'John',
      planName: 'Team',
      scope: 'organization',
      currentUsage: 500,
      limit: 500,
      ctaLink: 'https://sim.ai/organization/org_123/settings/billing',
    }),

  // Operational notification emails
  'schedule-disabled': () =>
    renderScheduleDisabledEmail({
      recipientName: 'John',
      resourceName: 'Daily digest',
      reason: 'consecutive_failures',
      failedCount: 100,
      manageLink: 'https://sim.ai/workspace/ws_123/w/wf_456',
    }),
  'schedule-disabled-auth': () =>
    renderScheduleDisabledEmail({
      recipientName: 'John',
      resourceName: 'Weekly report',
      reason: 'authentication_error',
      manageLink: 'https://sim.ai/workspace/ws_123/w/wf_456',
    }),
} as const

type EmailTemplate = keyof typeof emailTemplates

function isEmailTemplate(template: string): template is EmailTemplate {
  return template in emailTemplates
}

const CATEGORIZED = {
  Auth: ['otp', 'otp-sign-in', 'reset-password', 'existing-account', 'welcome'],
  Invitations: ['invitation', 'batch-invitation', 'workspace-invitation', 'workspace-added'],
  Support: ['help-confirmation'],
  Billing: [
    'usage-threshold',
    'usage-limit-reached',
    'usage-limit-reached-org',
    'free-tier-upgrade',
    'credits-exhausted',
    'limit-threshold-storage-warning',
    'limit-threshold-tables-reached',
    'limit-threshold-seats-reached',
    'payment-failed',
    'credit-purchase',
    'plan-welcome-pro',
    'plan-welcome-team',
    'enterprise-subscription',
  ],
  Notifications: ['schedule-disabled', 'schedule-disabled-auth'],
  'Plain (unbranded)': ['onboarding-followup', 'abandoned-checkout'],
} satisfies Record<string, EmailTemplate[]>

/**
 * Category map for the gallery, with any template missing from {@link CATEGORIZED}
 * appended rather than dropped — so a newly registered template always shows up
 * even if nobody remembers to file it.
 */
const PREVIEW_CATEGORIES: Record<string, EmailTemplate[]> = (() => {
  const filed = new Set<string>(Object.values(CATEGORIZED).flat())
  const unfiled = (Object.keys(emailTemplates) as EmailTemplate[]).filter((t) => !filed.has(t))
  return unfiled.length > 0 ? { ...CATEGORIZED, Uncategorized: unfiled } : CATEGORIZED
})()

export const GET = withRouteHandler(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url)
  const queryValidation = emailPreviewQuerySchema.safeParse(
    Object.fromEntries(searchParams.entries())
  )
  if (!queryValidation.success) return validationErrorResponse(queryValidation.error)
  const { template } = queryValidation.data

  if (!template) {
    const categoryHtml = Object.entries(PREVIEW_CATEGORIES)
      .map(
        ([category, templates]) => `
        <section>
          <h2>${category}</h2>
          <div class="grid">
          ${templates
            .map(
              (t) => `
            <figure>
              <figcaption><span>${t}</span><a href="?template=${t}" target="_blank" rel="noreferrer">open ↗</a></figcaption>
              <iframe src="?template=${t}" title="${t}" loading="lazy"></iframe>
            </figure>`
            )
            .join('')}
          </div>
        </section>`
      )
      .join('')

    return new NextResponse(
      `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Email Templates</title>
  <style>
    :root { color-scheme: light; }
    body { font-family: ${typography.systemFontFamily}; margin: 0; padding: 40px 24px 80px; background: ${colors.bgCard}; color: ${colors.textPrimary}; }
    h1 { font-size: 24px; font-weight: 600; margin: 0 0 4px; }
    .count { color: ${colors.textMuted}; font-size: 14px; margin: 0 0 40px; }
    h2 { font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: ${colors.textMuted}; margin: 48px 0 16px; padding-bottom: 8px; border-bottom: 1px solid ${colors.border}; }
    section { max-width: 1400px; margin: 0 auto; }
    section > h2:first-child { margin-top: 0; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(640px, 1fr)); gap: 32px; }
    figure { margin: 0 0 32px; }
    figcaption { display: flex; justify-content: space-between; align-items: baseline; font-size: 13px; margin-bottom: 8px; }
    figcaption span { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: ${colors.textBody}; }
    figcaption a { color: ${colors.textMuted}; text-decoration: none; font-size: 12px; }
    figcaption a:hover { color: ${colors.textPrimary}; }
    iframe { width: 100%; height: 900px; border: 1px solid ${colors.border}; border-radius: 8px; background: ${colors.bgCard}; display: block; }
  </style>
</head>
<body>
  <h1>Email Templates</h1>
  <p class="count">Every email Sim sends — ${Object.keys(emailTemplates).length} previews.</p>
  ${categoryHtml}
</body>
</html>`,
      { headers: { 'Content-Type': 'text/html' } }
    )
  }

  if (!isEmailTemplate(template)) {
    return NextResponse.json({ error: `Unknown template: ${template}` }, { status: 400 })
  }

  const html = await emailTemplates[template]()

  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html' },
  })
})
