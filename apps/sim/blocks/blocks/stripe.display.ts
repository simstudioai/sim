import { GoogleSheetsIcon, StripeIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const StripeBlockDisplay = {
  type: 'stripe',
  name: 'Stripe',
  description: 'Process payments and manage Stripe data',
  category: 'tools',
  bgColor: '#635BFF',
  icon: StripeIcon,
  iconColor: '#635BFF',
  longDescription:
    'Integrates Stripe into the workflow. Manage payment intents, customers, subscriptions, invoices, charges, products, prices, and events. Can be used in trigger mode to trigger a workflow when a Stripe event occurs.',
  docsLink: 'https://docs.sim.ai/integrations/stripe',
  integrationType: IntegrationType.Commerce,
} satisfies BlockDisplay

export const StripeBlockMeta = {
  tags: ['payments', 'subscriptions', 'webhooks'],
  url: 'https://stripe.com',
  templates: [
    {
      icon: GoogleSheetsIcon,
      title: 'Weekly metrics report',
      prompt:
        'Build a scheduled workflow that pulls data from Stripe and my database every Monday, calculates key metrics like MRR, churn, new subscriptions, and failed payments, writes results to Google Sheets, and sends the team a Slack summary with week-over-week trends.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['founder', 'finance', 'reporting'],
      alsoIntegrations: ['google_sheets', 'slack'],
    },
    {
      icon: StripeIcon,
      title: 'Revenue operations dashboard',
      prompt:
        'Create a scheduled daily workflow that pulls payment data from Stripe, calculates MRR, net revenue, failed payments, and new subscriptions, logs everything to a table with historical tracking, and sends a daily Slack summary with trends and anomalies.',
      modules: ['tables', 'scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'founder', 'reporting', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: StripeIcon,
      title: 'Failed payment recovery',
      prompt:
        'Build a workflow that listens for Stripe failed-payment events, looks up the customer, classifies the failure reason, drafts a tailored recovery email and a Slack alert to the success team, and logs the attempt in a tracking table so recovery rate can be measured.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'support', 'automation'],
      alsoIntegrations: ['gmail', 'slack'],
    },
    {
      icon: StripeIcon,
      title: 'Subscription churn flagger',
      prompt:
        'Create a scheduled daily workflow that lists Stripe subscriptions canceled or scheduled for cancellation, enriches each customer with usage and support history, scores the churn risk, and logs the cohort to a table with recommended save plays for the success team.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'support', 'analysis'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: StripeIcon,
      title: 'Invoice chase automation',
      prompt:
        'Build a scheduled workflow that lists Stripe invoices overdue by more than seven days, sends a polite chase email tailored to the customer history, escalates to a Slack alert at thirty days, and writes every action into a collections tracking table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'automation', 'reporting'],
      alsoIntegrations: ['gmail', 'slack'],
    },
    {
      icon: StripeIcon,
      title: 'New customer welcome flow',
      prompt:
        'Create a workflow triggered when a new Stripe customer is created. Send a personalized welcome email, create their onboarding checklist in a table, schedule a follow-up meeting via Calendly, and post a Slack notification to the customer success channel.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'sales', 'automation'],
      alsoIntegrations: ['gmail', 'calendly', 'slack'],
    },
    {
      icon: StripeIcon,
      title: 'Refund pattern analyzer',
      prompt:
        'Build a scheduled weekly workflow that lists Stripe charge and dispute events, classifies each refund or dispute by reason and product, identifies recurring patterns or fraud signals, writes a narrative report file, and Slacks finance with the top concerns and recommended actions.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['finance', 'analysis', 'reporting'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'collect-payment',
      description:
        'Create and confirm a Stripe payment intent to collect a charge from a customer.',
      content:
        '# Collect Payment\n\nCharge a customer by creating and confirming a payment intent.\n\n## Steps\n1. Run Create Payment Intent with the amount, currency, and customer.\n2. Confirm the intent with Confirm Payment Intent, or Capture Payment Intent if it was created for manual capture.\n3. If a charge needs to be aborted, run Cancel Payment Intent instead.\n\n## Output\nReturn the payment intent ID, its status (succeeded, requires action, or canceled), and the captured amount.',
    },
    {
      name: 'manage-subscription',
      description: 'Create, update, pause, or cancel a Stripe subscription for a customer.',
      content:
        '# Manage Subscription\n\nHandle the lifecycle of a recurring subscription.\n\n## Steps\n1. To start a subscription, run Create Subscription with the customer and price items.\n2. To change a plan, run Update Subscription with the new items. To pause and later restart, use Cancel Subscription or Resume Subscription as appropriate.\n3. Confirm the current state with Retrieve Subscription.\n\n## Output\nReturn the subscription ID, its status, current period end, and the plan items, and note exactly what changed.',
    },
    {
      name: 'issue-invoice',
      description: 'Create, finalize, and send a Stripe invoice to a customer, then track payment.',
      content:
        '# Issue Invoice\n\nBill a customer with a Stripe invoice.\n\n## Steps\n1. Run Create Invoice for the customer with the line items.\n2. Run Finalize Invoice to lock it, then Send Invoice to deliver it to the customer.\n3. Track payment with Retrieve Invoice, or run Pay Invoice to charge a saved payment method. Use Void Invoice to cancel an unpaid invoice.\n\n## Output\nReturn the invoice ID, its status (draft, open, paid, or void), the amount due, and the hosted invoice URL when available.',
    },
    {
      name: 'find-customer-activity',
      description:
        'Look up a Stripe customer and search their charges and payments for a financial summary.',
      content:
        '# Find Customer Activity\n\nBuild a payment history view for a single customer.\n\n## Steps\n1. Run Search Customers or Retrieve Customer to identify the customer and their ID.\n2. Run Search Charges or List Charges filtered to that customer to pull their transactions.\n3. Optionally run Search Payment Intents and List Invoices for a complete picture.\n\n## Output\nReturn the customer ID and email plus a summary of their charges and invoices, including total amount, successful versus failed payments, and any refunds.',
    },
  ],
} as const satisfies BlockMeta
