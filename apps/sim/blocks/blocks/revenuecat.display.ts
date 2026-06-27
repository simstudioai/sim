import { RevenueCatIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const RevenueCatBlockDisplay = {
  type: 'revenuecat',
  name: 'RevenueCat',
  description: 'Manage in-app subscriptions and entitlements',
  category: 'tools',
  bgColor: '#F25A5A',
  icon: RevenueCatIcon,
  iconColor: '#F25A5A',
  longDescription:
    'Integrate RevenueCat into the workflow. Manage subscribers, entitlements, offerings, and Google Play subscriptions. Retrieve customer subscription status, grant or revoke promotional entitlements, record purchases, update subscriber attributes, and manage Google Play subscription billing.',
  docsLink: 'https://docs.sim.ai/integrations/revenuecat',
  integrationType: IntegrationType.Commerce,
} satisfies BlockDisplay

export const RevenueCatBlockMeta = {
  tags: ['payments', 'subscriptions'],
  url: 'https://www.revenuecat.com',
  templates: [
    {
      icon: RevenueCatIcon,
      title: 'RevenueCat MRR dashboard',
      prompt:
        'Build a scheduled daily workflow that pulls RevenueCat subscriber and offering data, calculates MRR, ARPU, and trial-to-paid conversion, logs the metrics to a tracking table with historical trends, and posts a daily Slack summary for the growth team.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'reporting', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: RevenueCatIcon,
      title: 'Entitlement granter',
      prompt:
        'Create a workflow that listens for a customer-success approval — for example a Slack reaction or a row in a table — looks up the RevenueCat subscriber, grants a promotional entitlement with the right expiry, and logs the grant in an audit table for compliance.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'support', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: RevenueCatIcon,
      title: 'Failed renewal recovery',
      prompt:
        'Build a scheduled workflow that lists RevenueCat subscribers with failed renewals, segments them by plan and tenure, drafts a tailored win-back email, sends it via Gmail, and tracks recovery outcomes in a table with retry cadence rules.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'marketing', 'automation'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: RevenueCatIcon,
      title: 'Subscriber attribute sync',
      prompt:
        'Create a workflow that listens for changes in your customer table — like email, display name, or company — and updates the matching RevenueCat subscriber attributes so analytics and targeted offers always reflect the latest customer state.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'sync', 'automation'],
    },
    {
      icon: RevenueCatIcon,
      title: 'Trial expiry digest',
      prompt:
        'Build a scheduled daily workflow that lists RevenueCat subscribers whose trials expire in the next three days, ranks them by engagement, drafts a personalized conversion nudge, and emails the success team a prioritized list to call.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['sales', 'finance', 'reporting'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: RevenueCatIcon,
      title: 'Google Play refund operator',
      prompt:
        'Create a workflow that takes a refund approval from a support ticket, calls the RevenueCat Google Play refund operation with the right transaction identifier, revokes access, posts the outcome back on the ticket, and logs the action in a compliance table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'support', 'compliance'],
      alsoIntegrations: ['zendesk'],
    },
    {
      icon: RevenueCatIcon,
      title: 'Offering performance report',
      prompt:
        'Build a scheduled weekly workflow that pulls RevenueCat offerings and recent purchases, computes conversion rate per offering and per package, writes a narrative analysis file with recommendations, and Slacks growth leadership the top findings.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['finance', 'analysis', 'reporting'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'check-subscription-status',
      description: 'Look up a customer in RevenueCat and report their active entitlements.',
      content:
        '# Check Subscription Status\n\nDetermine what a customer is entitled to right now.\n\n## Steps\n1. Run get_customer with the app user id.\n2. Inspect the returned entitlements for active grants and expiration dates.\n3. Determine whether the customer has the entitlement you are gating on.\n4. Return a clear allow or deny decision.\n\n## Output\nReturn the active entitlements, their expiration dates, and whether the gated feature should be unlocked.',
    },
    {
      name: 'grant-promotional-access',
      description: 'Grant a promotional entitlement to a customer for support or a campaign.',
      content:
        '# Grant Promotional Access\n\nGive a customer temporary access via a promotional entitlement.\n\n## Steps\n1. Confirm the target app user id with get_customer.\n2. Run grant_entitlement with the entitlement identifier and duration.\n3. Verify the grant by re-checking get_customer.\n4. To reverse a grant later, run revoke_entitlement.\n\n## Output\nConfirm the granted entitlement, its duration, and the customer it was applied to.',
    },
    {
      name: 'process-subscription-refund',
      description: 'Refund and revoke a Google Play subscription for a customer support request.',
      content:
        '# Process Subscription Refund\n\nHandle a refund request for a store subscription.\n\n## Steps\n1. Look up the customer with get_customer to find the relevant subscription.\n2. For Google Play, run refund_google_subscription with the store transaction id.\n3. If access should end immediately, run revoke_google_subscription.\n4. Log the action for the support record.\n\n## Output\nConfirm the refund and revocation status, and the affected customer and product.',
    },
    {
      name: 'sync-subscriber-attributes',
      description: 'Update RevenueCat subscriber attributes to power targeting and analytics.',
      content:
        '# Sync Subscriber Attributes\n\nKeep RevenueCat subscriber attributes current.\n\n## Steps\n1. Gather the attributes to set (for example email, plan tier, or campaign source).\n2. Run update_subscriber_attributes for the app user id with the attribute map.\n3. Confirm the update with get_customer.\n\n## Output\nReturn the updated attributes and confirm they were applied to the subscriber.',
    },
  ],
} as const satisfies BlockMeta
