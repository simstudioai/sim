import { SendgridIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const SendGridBlockDisplay = {
  type: 'sendgrid',
  name: 'SendGrid',
  description: 'Send emails and manage contacts, lists, and templates with SendGrid',
  category: 'tools',
  bgColor: '#1A82E2',
  icon: SendgridIcon,
  longDescription:
    'Integrate SendGrid into your workflow. Send transactional emails, manage marketing contacts and lists, and work with email templates. Supports dynamic templates, attachments, and comprehensive contact management.',
  docsLink: 'https://docs.sim.ai/integrations/sendgrid',
  integrationType: IntegrationType.Email,
} satisfies BlockDisplay

export const SendGridBlockMeta = {
  tags: ['email-marketing', 'messaging'],
  url: 'https://www.twilio.com/en-us/sendgrid',
  templates: [
    {
      icon: SendgridIcon,
      title: 'SendGrid transactional pipeline',
      prompt:
        'Build a workflow that listens for product events from my tables — signup, password reset, receipt — picks the matching SendGrid dynamic template, populates the variables, sends the email, and writes the message ID back to the table for audit.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['automation', 'communication'],
    },
    {
      icon: SendgridIcon,
      title: 'SendGrid send-failure monitor',
      prompt:
        'Create a workflow that sends emails through SendGrid, logs each send result and any error to a delivery table, and posts a Slack alert summarizing failure patterns by recipient domain and template when the failure rate crosses a threshold.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['monitoring', 'analysis', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: SendgridIcon,
      title: 'SendGrid + Resend failover',
      prompt:
        'Build a workflow that sends transactional emails through SendGrid by default and automatically falls back to Resend when the primary send fails or rate limits, logging every send and the provider used to a delivery table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['automation', 'monitoring', 'enterprise'],
      alsoIntegrations: ['resend'],
    },
    {
      icon: SendgridIcon,
      title: 'SendGrid contact list cleaner',
      prompt:
        'Create a scheduled workflow that searches SendGrid marketing contacts for invalid or duplicate entries, removes the bad addresses, merges duplicates, and writes a cleanup report to a tracking table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'automation', 'analysis'],
    },
    {
      icon: SendgridIcon,
      title: 'SendGrid + SES enterprise sender',
      prompt:
        'Build a workflow that splits transactional traffic between SendGrid and AWS SES based on message category and recipient region, balances volume to stay under per-provider limits, and writes provider, status, and latency to a delivery table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'automation', 'monitoring'],
      alsoIntegrations: ['ses'],
    },
    {
      icon: SendgridIcon,
      title: 'SendGrid + Mailgun send scorecard',
      prompt:
        'Create a scheduled weekly workflow that sends categorized test messages through both SendGrid and Mailgun, records each provider response, latency, and error to a delivery table, and generates a scorecard file recommending which provider to use per send category.',
      modules: ['scheduled', 'tables', 'agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['analysis', 'reporting', 'enterprise'],
      alsoIntegrations: ['mailgun'],
    },
    {
      icon: SendgridIcon,
      title: 'SendGrid segmented list builder',
      prompt:
        'Build a workflow that reads a freshly scored audience from a table, creates a new SendGrid marketing list, adds each matching contact to the list, and removes anyone who no longer qualifies so the segment is ready for the next campaign send.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'automation', 'sync'],
    },
  ],
  skills: [
    {
      name: 'send-transactional-email',
      description:
        'Send a transactional email through SendGrid, optionally using a dynamic template and variables.',
      content:
        '# Send Transactional Email\n\nSend a single transactional email (receipt, confirmation, password reset) through SendGrid.\n\n## Steps\n1. Set the verified From address and the recipient To address.\n2. For a one-off message, set the Subject and Content (choose HTML or plain text). For a templated message, set the Template ID and provide Dynamic Template Data as a JSON object whose keys match the template variables.\n3. Add CC, BCC, or Reply-To addresses if needed, and attach files via Attachments.\n4. Run the Send Mail operation and capture the returned message ID.\n\n## Output\nReport whether the send succeeded and include the SendGrid message ID for later delivery tracking and audit.',
    },
    {
      name: 'sync-contacts-to-list',
      description:
        'Add or update marketing contacts and place them on a specific SendGrid list for a campaign segment.',
      content:
        '# Sync Contacts to List\n\nUpsert marketing contacts and assign them to a SendGrid list so a segment is ready to receive a campaign.\n\n## Steps\n1. If the target list does not exist, run Create List with a descriptive name and keep the returned list ID.\n2. Build a JSON array of contacts, each with at least an email plus optional first name, last name, and custom fields.\n3. Run Add Contacts to List with the list ID and the contacts array.\n4. Optionally run Remove Contacts from List to drop addresses that no longer qualify for the segment.\n\n## Output\nReport the list ID, the count of contacts added, and the job ID returned for the async upsert.',
    },
    {
      name: 'clean-contact-list',
      description:
        'Search SendGrid marketing contacts for invalid or unwanted addresses and remove them.',
      content:
        '# Clean Contact List\n\nFind and remove low-quality marketing contacts using SendGrid Query Language.\n\n## Steps\n1. Run Search Contacts with an SGQL query that targets the unwanted records (for example addresses matching a bad domain or stale by created date).\n2. Collect the contact IDs from the results.\n3. Run Delete Contacts with the comma-separated contact IDs, or Remove Contacts from List to drop them only from a specific segment.\n4. Record what was removed for a cleanup report.\n\n## Output\nReport the search criteria used, the number of contacts found, and how many were deleted or removed from the list.',
    },
    {
      name: 'create-dynamic-template',
      description:
        'Create a SendGrid dynamic template and an active version with HTML and a subject line.',
      content:
        '# Create Dynamic Template\n\nStand up a reusable SendGrid dynamic template for a recurring transactional message.\n\n## Steps\n1. Run Create Template with a descriptive name and the dynamic generation.\n2. Keep the returned template ID.\n3. Run Create Template Version against that template ID, supplying a version name, the Template Subject (Handlebars variables allowed), and the HTML content. Set the version active so it is used on send.\n4. Optionally supply plain text content as a fallback.\n\n## Output\nReport the template ID and version, and confirm the active version is ready to reference from Send Mail operations.',
    },
  ],
} as const satisfies BlockMeta
