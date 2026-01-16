import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import {
  renderBatchInvitationEmail,
  renderCareersConfirmationEmail,
  renderCareersSubmissionEmail,
  renderCreditPurchaseEmail,
  renderEnterpriseSubscriptionEmail,
  renderFreeTierUpgradeEmail,
  renderHelpConfirmationEmail,
  renderInvitationEmail,
  renderOTPEmail,
  renderPasswordResetEmail,
  renderPaymentFailedEmail,
  renderPlanWelcomeEmail,
  renderUsageThresholdEmail,
  renderWelcomeEmail,
  renderWorkflowNotificationEmail,
  renderWorkspaceInvitationEmail,
} from '@/components/emails'

const emailTemplates = {
  // Auth emails
  otp: () => renderOTPEmail('123456', 'user@example.com', 'email-verification'),
  'reset-password': () => renderPasswordResetEmail('John', 'https://sim.ai/reset?token=abc123'),
  welcome: () => renderWelcomeEmail('John'),

  // Invitation emails
  invitation: () => renderInvitationEmail('Jane Doe', 'Acme Corp', 'https://sim.ai/invite/abc123'),
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
      'Engineering Team',
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
  'payment-failed': () =>
    renderPaymentFailedEmail({
      userName: 'John',
      amountDue: 20,
      lastFourDigits: '4242',
      billingPortalUrl: 'https://sim.ai/settings/billing',
      failureReason: 'Card declined',
    }),

  // Careers emails
  'careers-confirmation': () => renderCareersConfirmationEmail('John Doe', 'Senior Engineer'),
  'careers-submission': () =>
    renderCareersSubmissionEmail({
      name: 'John Doe',
      email: 'john@example.com',
      phone: '+1 (555) 123-4567',
      position: 'Senior Engineer',
      linkedin: 'https://linkedin.com/in/johndoe',
      portfolio: 'https://johndoe.dev',
      experience: '5-10',
      location: 'San Francisco, CA',
      message:
        'I have 10 years of experience building scalable distributed systems. Most recently, I led a team at a Series B startup where we scaled from 100K to 10M users.',
    }),

  // Notification emails
  'workflow-notification-success': () =>
    renderWorkflowNotificationEmail({
      workflowName: 'Customer Onboarding Flow',
      status: 'success',
      trigger: 'api',
      duration: '2.3s',
      cost: '$0.0042',
      logUrl: 'https://sim.ai/workspace/ws_123/logs?search=exec_abc123',
    }),
  'workflow-notification-error': () =>
    renderWorkflowNotificationEmail({
      workflowName: 'Customer Onboarding Flow',
      status: 'error',
      trigger: 'webhook',
      duration: '1.1s',
      cost: '$0.0021',
      logUrl: 'https://sim.ai/workspace/ws_123/logs?search=exec_abc123',
    }),
  'workflow-notification-alert': () =>
    renderWorkflowNotificationEmail({
      workflowName: 'Customer Onboarding Flow',
      status: 'error',
      trigger: 'schedule',
      duration: '45.2s',
      cost: '$0.0156',
      logUrl: 'https://sim.ai/workspace/ws_123/logs?search=exec_abc123',
      alertReason: '3 consecutive failures detected',
    }),
  'workflow-notification-full': () =>
    renderWorkflowNotificationEmail({
      workflowName: 'Data Processing Pipeline',
      status: 'success',
      trigger: 'api',
      duration: '12.5s',
      cost: '$0.0234',
      logUrl: 'https://sim.ai/workspace/ws_123/logs?search=exec_abc123',
      finalOutput: { processed: 150, skipped: 3, status: 'completed' },
      rateLimits: {
        sync: { requestsPerMinute: 60, remaining: 45 },
        async: { requestsPerMinute: 120, remaining: 98 },
      },
      usageData: { currentPeriodCost: 12.45, limit: 50, percentUsed: 24.9 },
    }),
} as const

type EmailTemplate = keyof typeof emailTemplates

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const template = searchParams.get('template') as EmailTemplate | null

  if (!template) {
    const categories = {
      Auth: ['otp', 'reset-password', 'welcome'],
      Invitations: ['invitation', 'batch-invitation', 'workspace-invitation'],
      Support: ['help-confirmation'],
      Billing: [
        'usage-threshold',
        'enterprise-subscription',
        'free-tier-upgrade',
        'plan-welcome-pro',
        'plan-welcome-team',
        'credit-purchase',
        'payment-failed',
      ],
      Careers: ['careers-confirmation', 'careers-submission'],
      Notifications: [
        'workflow-notification-success',
        'workflow-notification-error',
        'workflow-notification-alert',
        'workflow-notification-full',
      ],
    }

    const categoryHtml = Object.entries(categories)
      .map(
        ([category, templates]) => `
        <h2 style="margin-top: 24px; margin-bottom: 12px; font-size: 14px; color: #666; text-transform: uppercase; letter-spacing: 0.5px;">${category}</h2>
        <ul style="list-style: none; padding: 0; margin: 0;">
          ${templates.map((t) => `<li style="margin: 8px 0;"><a href="?template=${t}" style="color: #32bd7e; text-decoration: none; font-size: 16px;">${t}</a></li>`).join('')}
        </ul>
      `
      )
      .join('')

    return new NextResponse(
      `<!DOCTYPE html>
<html>
<head>
  <title>Email Previews</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 40px auto; padding: 20px; }
    h1 { color: #333; margin-bottom: 32px; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <h1>Email Templates</h1>
  ${categoryHtml}
</body>
</html>`,
      { headers: { 'Content-Type': 'text/html' } }
    )
  }

  if (!(template in emailTemplates)) {
    return NextResponse.json({ error: `Unknown template: ${template}` }, { status: 400 })
  }

  const html = await emailTemplates[template]()

  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html' },
  })
}
