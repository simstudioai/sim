import { SESIcon } from '@/components/icons'
import { SESBlockDisplay } from '@/blocks/blocks/ses.display'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { ToolResponse } from '@/tools/types'

export const SESBlock: BlockConfig<ToolResponse> = {
  ...SESBlockDisplay,
  authMode: AuthMode.ApiKey,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Send Email', id: 'send_email' },
        { label: 'Send Templated Email', id: 'send_templated_email' },
        { label: 'Send Bulk Email', id: 'send_bulk_email' },
        { label: 'List Identities', id: 'list_identities' },
        { label: 'Get Account', id: 'get_account' },
        { label: 'Create Template', id: 'create_template' },
        { label: 'Get Template', id: 'get_template' },
        { label: 'List Templates', id: 'list_templates' },
        { label: 'Delete Template', id: 'delete_template' },
      ],
      value: () => 'send_email',
    },
    {
      id: 'region',
      title: 'AWS Region',
      type: 'short-input',
      placeholder: 'us-east-1',
      required: true,
    },
    {
      id: 'accessKeyId',
      title: 'AWS Access Key ID',
      type: 'short-input',
      placeholder: 'AKIA...',
      password: true,
      required: true,
    },
    {
      id: 'secretAccessKey',
      title: 'AWS Secret Access Key',
      type: 'short-input',
      placeholder: 'Your secret access key',
      password: true,
      required: true,
    },
    {
      id: 'fromAddress',
      title: 'From Address',
      type: 'short-input',
      placeholder: 'sender@example.com',
      condition: {
        field: 'operation',
        value: ['send_email', 'send_templated_email', 'send_bulk_email'],
      },
      required: {
        field: 'operation',
        value: ['send_email', 'send_templated_email', 'send_bulk_email'],
      },
    },
    {
      id: 'toAddresses',
      title: 'To Addresses',
      type: 'short-input',
      placeholder: 'recipient@example.com, other@example.com',
      condition: {
        field: 'operation',
        value: ['send_email', 'send_templated_email'],
      },
      required: {
        field: 'operation',
        value: ['send_email', 'send_templated_email'],
      },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a comma-separated list of recipient email addresses. Return ONLY the comma-separated addresses - no explanations, no extra text.',
        placeholder: 'e.g. alice@example.com, bob@example.com',
      },
    },
    {
      id: 'subject',
      title: 'Subject',
      type: 'short-input',
      placeholder: 'Your email subject',
      condition: { field: 'operation', value: 'send_email' },
      required: { field: 'operation', value: 'send_email' },
    },
    {
      id: 'bodyHtml',
      title: 'HTML Body',
      type: 'long-input',
      placeholder: '<h1>Hello</h1><p>Your email content here</p>',
      condition: { field: 'operation', value: 'send_email' },
      required: false,
    },
    {
      id: 'bodyText',
      title: 'Plain Text Body',
      type: 'long-input',
      placeholder: 'Plain text version of your email',
      condition: { field: 'operation', value: 'send_email' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'templateName',
      title: 'Template Name',
      type: 'short-input',
      placeholder: 'my-email-template',
      condition: {
        field: 'operation',
        value: [
          'send_templated_email',
          'send_bulk_email',
          'get_template',
          'create_template',
          'delete_template',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'send_templated_email',
          'send_bulk_email',
          'get_template',
          'create_template',
          'delete_template',
        ],
      },
    },
    {
      id: 'templateData',
      title: 'Template Data (JSON)',
      type: 'code',
      language: 'json',
      placeholder: '{"name": "John", "link": "https://example.com"}',
      condition: { field: 'operation', value: 'send_templated_email' },
      required: { field: 'operation', value: 'send_templated_email' },
    },
    {
      id: 'destinations',
      title: 'Destinations (JSON)',
      type: 'code',
      language: 'json',
      placeholder:
        '[{"toAddresses": ["user1@example.com"], "templateData": "{\"name\": \"User 1\"}"}, {"toAddresses": ["user2@example.com"]}]',
      condition: { field: 'operation', value: 'send_bulk_email' },
      required: { field: 'operation', value: 'send_bulk_email' },
    },
    {
      id: 'subjectPart',
      title: 'Subject',
      type: 'short-input',
      placeholder: 'Hello, {{name}}!',
      condition: { field: 'operation', value: 'create_template' },
      required: { field: 'operation', value: 'create_template' },
    },
    {
      id: 'htmlPart',
      title: 'HTML Body',
      type: 'long-input',
      placeholder: '<h1>Hello, {{name}}!</h1>',
      condition: { field: 'operation', value: 'create_template' },
      required: false,
    },
    {
      id: 'textPart',
      title: 'Plain Text Body',
      type: 'long-input',
      placeholder: 'Hello, {{name}}!',
      condition: { field: 'operation', value: 'create_template' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'ccAddresses',
      title: 'CC Addresses',
      type: 'short-input',
      placeholder: 'cc@example.com',
      condition: {
        field: 'operation',
        value: ['send_email', 'send_templated_email'],
      },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'bccAddresses',
      title: 'BCC Addresses',
      type: 'short-input',
      placeholder: 'bcc@example.com',
      condition: {
        field: 'operation',
        value: ['send_email', 'send_templated_email'],
      },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'replyToAddresses',
      title: 'Reply-To Addresses',
      type: 'short-input',
      placeholder: 'replyto@example.com',
      condition: { field: 'operation', value: 'send_email' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'defaultTemplateData',
      title: 'Default Template Data (JSON)',
      type: 'code',
      language: 'json',
      placeholder: '{"company": "Acme"}',
      condition: { field: 'operation', value: 'send_bulk_email' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'configurationSetName',
      title: 'Configuration Set',
      type: 'short-input',
      placeholder: 'my-configuration-set',
      condition: {
        field: 'operation',
        value: ['send_email', 'send_templated_email', 'send_bulk_email'],
      },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'pageSize',
      title: 'Page Size',
      type: 'short-input',
      placeholder: '100',
      condition: {
        field: 'operation',
        value: ['list_identities', 'list_templates'],
      },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'nextToken',
      title: 'Next Token',
      type: 'short-input',
      placeholder: 'Pagination token from previous response',
      condition: {
        field: 'operation',
        value: ['list_identities', 'list_templates'],
      },
      required: false,
      mode: 'advanced',
    },
  ],
  tools: {
    access: [
      'ses_send_email',
      'ses_send_templated_email',
      'ses_send_bulk_email',
      'ses_list_identities',
      'ses_get_account',
      'ses_create_template',
      'ses_get_template',
      'ses_list_templates',
      'ses_delete_template',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'send_email':
            return 'ses_send_email'
          case 'send_templated_email':
            return 'ses_send_templated_email'
          case 'send_bulk_email':
            return 'ses_send_bulk_email'
          case 'list_identities':
            return 'ses_list_identities'
          case 'get_account':
            return 'ses_get_account'
          case 'create_template':
            return 'ses_create_template'
          case 'get_template':
            return 'ses_get_template'
          case 'list_templates':
            return 'ses_list_templates'
          case 'delete_template':
            return 'ses_delete_template'
          default:
            throw new Error(`Invalid SES operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const { operation, pageSize, ...rest } = params

        const connectionConfig = {
          region: rest.region,
          accessKeyId: rest.accessKeyId,
          secretAccessKey: rest.secretAccessKey,
        }

        const result: Record<string, unknown> = { ...connectionConfig }

        switch (operation) {
          case 'send_email':
            result.fromAddress = rest.fromAddress
            result.toAddresses = rest.toAddresses
            result.subject = rest.subject
            if (rest.bodyHtml) result.bodyHtml = rest.bodyHtml
            if (rest.bodyText) result.bodyText = rest.bodyText
            if (rest.ccAddresses) result.ccAddresses = rest.ccAddresses
            if (rest.bccAddresses) result.bccAddresses = rest.bccAddresses
            if (rest.replyToAddresses) result.replyToAddresses = rest.replyToAddresses
            if (rest.configurationSetName) result.configurationSetName = rest.configurationSetName
            break
          case 'send_templated_email':
            result.fromAddress = rest.fromAddress
            result.toAddresses = rest.toAddresses
            result.templateName = rest.templateName
            result.templateData = rest.templateData
            if (rest.ccAddresses) result.ccAddresses = rest.ccAddresses
            if (rest.bccAddresses) result.bccAddresses = rest.bccAddresses
            if (rest.configurationSetName) result.configurationSetName = rest.configurationSetName
            break
          case 'send_bulk_email':
            result.fromAddress = rest.fromAddress
            result.templateName = rest.templateName
            result.destinations = rest.destinations
            if (rest.defaultTemplateData) result.defaultTemplateData = rest.defaultTemplateData
            if (rest.configurationSetName) result.configurationSetName = rest.configurationSetName
            break
          case 'list_identities':
            if (pageSize != null) {
              const parsed = Number.parseInt(String(pageSize), 10)
              if (!Number.isNaN(parsed)) result.pageSize = parsed
            }
            if (rest.nextToken) result.nextToken = rest.nextToken
            break
          case 'get_account':
            break
          case 'create_template':
            result.templateName = rest.templateName
            result.subjectPart = rest.subjectPart
            if (rest.htmlPart) result.htmlPart = rest.htmlPart
            if (rest.textPart) result.textPart = rest.textPart
            break
          case 'get_template':
            result.templateName = rest.templateName
            break
          case 'list_templates':
            if (pageSize != null) {
              const parsed = Number.parseInt(String(pageSize), 10)
              if (!Number.isNaN(parsed)) result.pageSize = parsed
            }
            if (rest.nextToken) result.nextToken = rest.nextToken
            break
          case 'delete_template':
            result.templateName = rest.templateName
            break
        }

        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'SES operation to perform' },
    region: { type: 'string', description: 'AWS region' },
    accessKeyId: { type: 'string', description: 'AWS access key ID' },
    secretAccessKey: { type: 'string', description: 'AWS secret access key' },
    fromAddress: { type: 'string', description: 'Verified sender email address' },
    toAddresses: {
      type: 'string',
      description: 'Comma-separated list of recipient email addresses',
    },
    subject: { type: 'string', description: 'Email subject line' },
    bodyHtml: { type: 'string', description: 'HTML email body' },
    bodyText: { type: 'string', description: 'Plain text email body' },
    templateName: { type: 'string', description: 'SES template name' },
    templateData: { type: 'string', description: 'JSON template variable data' },
    destinations: {
      type: 'string',
      description: 'JSON array of bulk email destinations',
    },
    subjectPart: { type: 'string', description: 'Template subject line' },
    htmlPart: { type: 'string', description: 'HTML body of the template' },
    textPart: { type: 'string', description: 'Plain text body of the template' },
    ccAddresses: { type: 'string', description: 'Comma-separated CC email addresses' },
    bccAddresses: { type: 'string', description: 'Comma-separated BCC email addresses' },
    replyToAddresses: { type: 'string', description: 'Comma-separated reply-to addresses' },
    defaultTemplateData: {
      type: 'string',
      description: 'Default JSON template data for bulk sends',
    },
    configurationSetName: { type: 'string', description: 'SES configuration set name' },
    pageSize: { type: 'number', description: 'Maximum number of results to return' },
    nextToken: { type: 'string', description: 'Pagination token from previous response' },
  },
  outputs: {
    messageId: {
      type: 'string',
      description: 'SES message ID (send_email, send_templated_email)',
      condition: { field: 'operation', value: ['send_email', 'send_templated_email'] },
    },
    results: {
      type: 'array',
      description: 'Per-destination send results (send_bulk_email)',
      condition: { field: 'operation', value: 'send_bulk_email' },
    },
    successCount: {
      type: 'number',
      description: 'Number of successfully sent emails (send_bulk_email)',
      condition: { field: 'operation', value: 'send_bulk_email' },
    },
    failureCount: {
      type: 'number',
      description: 'Number of failed email sends (send_bulk_email)',
      condition: { field: 'operation', value: 'send_bulk_email' },
    },
    identities: {
      type: 'array',
      description: 'List of verified email identities (list_identities)',
      condition: { field: 'operation', value: 'list_identities' },
    },
    nextToken: {
      type: 'string',
      description: 'Pagination token for the next page (list_identities, list_templates)',
      condition: { field: 'operation', value: ['list_identities', 'list_templates'] },
    },
    count: {
      type: 'number',
      description: 'Number of items returned (list_identities, list_templates)',
      condition: { field: 'operation', value: ['list_identities', 'list_templates'] },
    },
    sendingEnabled: {
      type: 'boolean',
      description: 'Whether email sending is enabled (get_account)',
      condition: { field: 'operation', value: 'get_account' },
    },
    max24HourSend: {
      type: 'number',
      description: 'Maximum emails per 24 hours (get_account)',
      condition: { field: 'operation', value: 'get_account' },
    },
    maxSendRate: {
      type: 'number',
      description: 'Maximum emails per second (get_account)',
      condition: { field: 'operation', value: 'get_account' },
    },
    sentLast24Hours: {
      type: 'number',
      description: 'Emails sent in the last 24 hours (get_account)',
      condition: { field: 'operation', value: 'get_account' },
    },
    templateName: {
      type: 'string',
      description: 'Template name (get_template)',
      condition: { field: 'operation', value: 'get_template' },
    },
    subjectPart: {
      type: 'string',
      description: 'Template subject (get_template)',
      condition: { field: 'operation', value: 'get_template' },
    },
    textPart: {
      type: 'string',
      description: 'Template plain text body (get_template)',
      condition: { field: 'operation', value: 'get_template' },
    },
    htmlPart: {
      type: 'string',
      description: 'Template HTML body (get_template)',
      condition: { field: 'operation', value: 'get_template' },
    },
    templates: {
      type: 'array',
      description: 'List of email templates (list_templates)',
      condition: { field: 'operation', value: 'list_templates' },
    },
    message: {
      type: 'string',
      description: 'Confirmation message (create_template, delete_template)',
      condition: { field: 'operation', value: ['create_template', 'delete_template'] },
    },
  },
}

export const SESBlockMeta = {
  tags: ['cloud', 'email-marketing', 'messaging'],
  url: 'https://aws.amazon.com/ses',
  templates: [
    {
      icon: SESIcon,
      title: 'SES bulk announcement',
      prompt:
        'Create a workflow that takes a recipient list from a table and an SES email template, sends the announcement using SES bulk send with per-recipient template data, and writes the per-recipient send status back to the table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'automation', 'communication'],
    },
    {
      icon: SESIcon,
      title: 'SES verified-identity audit',
      prompt:
        'Build a scheduled workflow that lists AWS SES verified identities, checks the account sending quota and reputation, and posts a Slack report when any identity is unverified or the account approaches the daily quota.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'monitoring', 'infrastructure'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: SESIcon,
      title: 'SES templated nurture',
      prompt:
        'Create a workflow that walks each contact in a tables-based nurture sequence through staged SES templated sends with delays between steps, branches on open or click, and stops the sequence when the contact replies.',
      modules: ['tables', 'scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'automation'],
    },
    {
      icon: SESIcon,
      title: 'SES + Mailgun multi-region sender',
      prompt:
        'Build a workflow that routes transactional emails through SES in primary regions and through Mailgun for regions where SES is not provisioned, normalizing template variables and writing one unified send log to a table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'infrastructure', 'automation'],
      alsoIntegrations: ['mailgun'],
    },
    {
      icon: SESIcon,
      title: 'SES + AgentMail customer concierge',
      prompt:
        'Create a workflow that sends outbound customer messages through AWS SES but provisions a per-customer AgentMail inbox to receive replies, threads conversations across both, and tags AgentMail threads with the customer ID.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['support', 'communication', 'automation'],
      alsoIntegrations: ['agentmail'],
    },
    {
      icon: SESIcon,
      title: 'SES domain reputation monitor',
      prompt:
        'Build a scheduled daily workflow that pulls SES account sending statistics and per-identity reputation indicators, logs them to a tracking table for trend lines, and flags any identity whose complaint or bounce rate is trending up.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'monitoring', 'analysis'],
    },
    {
      icon: SESIcon,
      title: 'SES template library sync',
      prompt:
        'Build a workflow that reads my approved email templates from a table, creates or updates each one in AWS SES with create template, lists existing SES templates to detect drift, and deletes templates that have been removed from the table so the SES library stays in sync.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['marketing', 'automation', 'content'],
    },
  ],
  skills: [
    {
      name: 'send-notification-email',
      description:
        'Send a transactional email through AWS SES to one or more recipients. Use for alerts, confirmations, and one-off notifications from a workflow.',
      content:
        '# Send Notification Email\n\nSend a transactional email via SES.\n\n## Steps\n1. Determine the verified sender identity, the recipients, subject, and body.\n2. Choose a plain-text or HTML body to match the message.\n3. Send the email, including reply-to or CC recipients if needed.\n4. Confirm the send succeeded and capture the message ID.\n\n## Output\nReport the SES message ID and the recipients. If the send was rejected, surface the SES error (for example, an unverified sender or sandbox restriction).',
    },
    {
      name: 'send-templated-campaign',
      description:
        'Send a templated SES email to many recipients with per-recipient personalization. Use for newsletters, onboarding sequences, and bulk notifications.',
      content:
        "# Send Templated Campaign\n\nSend personalized emails using an SES template.\n\n## Steps\n1. Confirm the template exists with get template, or create it first.\n2. Assemble the recipient list with each recipient's template data for personalization.\n3. Use send bulk email for many recipients, or send templated email for a single message.\n4. Collect per-recipient send status.\n\n## Output\nReport how many messages were accepted versus failed, with message IDs and the reason for any failures.",
    },
    {
      name: 'manage-email-templates',
      description:
        'Create, fetch, list, and delete reusable email templates in AWS SES. Use to maintain a consistent, version-controlled template library.',
      content:
        '# Manage Email Templates\n\nMaintain the SES template library.\n\n## Steps\n1. To add a template, create it with a name, subject, and HTML and text parts using placeholder variables.\n2. To review, get a template by name or list templates.\n3. To retire one, delete the template by name.\n4. Keep template names descriptive so they are easy to reference when sending.\n\n## Output\nReport the template name affected and the action taken, or the template contents for a fetch.',
    },
    {
      name: 'check-sending-health',
      description:
        'Inspect AWS SES account sending limits, quota usage, and verified identities. Use to confirm capacity and deliverability readiness before a send.',
      content:
        '# Check Sending Health\n\nVerify SES is ready to send.\n\n## Steps\n1. Get the account to read the sending quota, send rate, and whether the account is out of the sandbox.\n2. List identities to confirm the intended sender domain or address is verified.\n3. Compare planned volume against the remaining 24-hour quota.\n4. Flag any blockers — sandbox mode, unverified senders, or quota nearly exhausted.\n\n## Output\nReport sending enabled status, quota used versus max, and any unverified identities that would block the send.',
    },
  ],
} as const satisfies BlockMeta
