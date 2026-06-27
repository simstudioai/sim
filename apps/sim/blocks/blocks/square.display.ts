import { SquareIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const SquareBlockDisplay = {
  type: 'square',
  name: 'Square',
  description: 'Process payments and manage Square commerce data',
  category: 'tools',
  bgColor: '#000000',
  icon: SquareIcon,
  longDescription:
    'Integrate Square into the workflow. Take and refund payments, manage customers, build catalog items and images, create and search orders, and issue invoices. Authenticate with a Square access token (personal access token).',
  docsLink: 'https://docs.sim.ai/integrations/square',
  integrationType: IntegrationType.Commerce,
} satisfies BlockDisplay

export const SquareBlockMeta = {
  tags: ['payments', 'subscriptions', 'automation'],
  url: 'https://squareup.com',
  templates: [
    {
      icon: SquareIcon,
      title: 'Daily sales summary',
      prompt:
        'Build a scheduled daily workflow that lists Square payments from the previous day across all locations, totals gross sales, refunds, and net revenue, writes the figures to a table for historical tracking, and posts a Slack summary with day-over-day trends.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'reporting', 'founder'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: SquareIcon,
      title: 'Refund pattern monitor',
      prompt:
        'Create a scheduled weekly workflow that lists Square payments and their refunds, classifies each refund by reason and location, flags any location with an unusually high refund rate, and emails finance a narrative report with recommended actions.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['finance', 'analysis', 'monitoring'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: SquareIcon,
      title: 'New customer welcome',
      prompt:
        'Build a workflow that takes a new Square customer, creates a welcome email tailored to their purchase, adds them to an onboarding tracking table, and posts a notification to the customer success Slack channel.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['sales', 'automation'],
      alsoIntegrations: ['gmail', 'slack'],
    },
    {
      icon: SquareIcon,
      title: 'Invoice chase automation',
      prompt:
        'Create a scheduled workflow that lists Square invoices for a location, finds those that are unpaid past their due date, sends a polite reminder email per customer, and logs every chase action to a collections table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'automation', 'reporting'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: SquareIcon,
      title: 'Catalog image enrichment',
      prompt:
        'Build a workflow that lists Square catalog items missing images, generates a product image for each one, uploads it as a catalog image attached to the item, and writes a report of which items were updated.',
      modules: ['agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['ecommerce', 'automation'],
    },
    {
      icon: SquareIcon,
      title: 'Low-stock reorder alerts',
      prompt:
        'Create a scheduled workflow that lists the Square catalog, identifies items flagged as low or out of stock, drafts a reorder summary grouped by supplier, and posts it to a Slack purchasing channel with the items and quantities to reorder.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['ecommerce', 'operations'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: SquareIcon,
      title: 'Customer purchase history lookup',
      prompt:
        'Build a workflow that searches Square customers by email, pulls their orders and payments, summarizes lifetime spend and most-purchased items, and returns a concise profile the support team can use during a conversation.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['support', 'analysis'],
    },
  ],
  skills: [
    {
      name: 'take-payment',
      description: 'Take a Square payment from a payment source and confirm the result.',
      content:
        '# Take Payment\n\nCharge a customer using Square.\n\n## Steps\n1. Run Create Payment with the source ID (card nonce or card on file), the amount in the smallest denomination, and the currency.\n2. Optionally attach a customer ID, location ID, or order ID.\n3. Confirm the result with Get Payment if you need the latest status.\n\n## Output\nReturn the payment ID, status (APPROVED, COMPLETED, or FAILED), and the amount charged. If a refund is needed, run Refund Payment with the payment ID.',
    },
    {
      name: 'issue-and-publish-invoice',
      description: 'Create a Square invoice for an order and publish it to the customer.',
      content:
        '# Issue And Publish Invoice\n\nBill a customer with a Square invoice.\n\n## Steps\n1. Make sure an order exists (use Create Order if needed) and you have the customer ID.\n2. Run Create Invoice with an invoice object referencing the location, order, primary recipient (customer), and payment requests. Note the returned invoice ID and version.\n3. Run Publish Invoice with that invoice ID and version to send it to the customer.\n4. Track payment with Get Invoice.\n\n## Output\nReturn the invoice ID, status, and the public URL where the customer can pay.',
    },
    {
      name: 'manage-catalog-item',
      description: 'Create or update a Square catalog item and attach an image to it.',
      content:
        '# Manage Catalog Item\n\nBuild out the Square catalog.\n\n## Steps\n1. Run Upsert Catalog Object with an ITEM object (use a temporary id like "#Name" for new items). Capture the returned object ID.\n2. To add a picture, run Create Catalog Image with the image file and the object ID to attach it to the item.\n3. Verify with Get Catalog Object or Search Catalog Objects.\n\n## Output\nReturn the catalog object ID, type, and version, plus the image object ID when an image was attached.',
    },
    {
      name: 'find-customer-activity',
      description: 'Look up a Square customer and summarize their orders and payments.',
      content:
        '# Find Customer Activity\n\nBuild a purchase history view for one customer.\n\n## Steps\n1. Run Search Customers (by email or phone) or Get Customer to identify the customer and their ID.\n2. Run Search Orders across the relevant locations filtered to that customer.\n3. Run List Payments and match payments to the customer for a full financial picture.\n\n## Output\nReturn the customer ID and email plus a summary of their orders and payments: total spend, number of orders, and any refunds.',
    },
  ],
} as const satisfies BlockMeta
