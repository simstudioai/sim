import { SmtpIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { normalizeFileInput } from '@/blocks/utils'
import type { SmtpSendMailResult } from '@/tools/smtp/types'

export const SmtpBlock: BlockConfig<SmtpSendMailResult> = {
  type: 'smtp',
  name: 'SMTP',
  description: 'Send emails via any SMTP mail server',
  longDescription:
    'Send emails using any SMTP server (Gmail, Outlook, custom servers, etc.). Configure SMTP connection settings and send emails with full control over content, recipients, and attachments.',
  docsLink: 'https://docs.sim.ai/integrations/smtp',
  category: 'tools',
  integrationType: IntegrationType.Email,
  bgColor: '#2D3748',
  icon: SmtpIcon,
  authMode: AuthMode.ApiKey,

  subBlocks: [
    {
      id: 'smtpHost',
      title: 'SMTP Host',
      type: 'short-input',
      placeholder: 'smtp.gmail.com, smtp.example.com',
      required: true,
    },
    {
      id: 'smtpPort',
      title: 'SMTP Port',
      type: 'short-input',
      placeholder: '587',
      required: true,
      value: () => '587',
    },
    {
      id: 'smtpUsername',
      title: 'SMTP Username',
      type: 'short-input',
      placeholder: 'your-email@example.com',
      required: true,
    },
    {
      id: 'smtpPassword',
      title: 'SMTP Password',
      type: 'short-input',
      placeholder: 'Your SMTP password',
      required: true,
      password: true,
    },
    {
      id: 'smtpSecure',
      title: 'Security Mode',
      type: 'dropdown',
      options: [
        { label: 'TLS (Port 587)', id: 'TLS' },
        { label: 'SSL (Port 465)', id: 'SSL' },
        { label: 'None (Port 25)', id: 'None' },
      ],
      value: () => 'TLS',
      required: true,
    },

    {
      id: 'from',
      title: 'From',
      type: 'short-input',
      placeholder: 'sender@example.com',
      required: true,
    },
    {
      id: 'to',
      title: 'To',
      type: 'short-input',
      placeholder: 'recipient@example.com',
      required: true,
    },
    {
      id: 'subject',
      title: 'Subject',
      type: 'short-input',
      placeholder: 'Email subject',
      required: true,
    },
    {
      id: 'body',
      title: 'Body',
      type: 'long-input',
      placeholder: 'Email content',
      required: true,
    },
    {
      id: 'contentType',
      title: 'Content Type',
      type: 'dropdown',
      options: [
        { label: 'Plain Text', id: 'text' },
        { label: 'HTML', id: 'html' },
      ],
      value: () => 'text',
      required: false,
    },

    // Attachments Section
    // File upload (basic mode)
    {
      id: 'attachmentFiles',
      title: 'Attachments',
      type: 'file-upload',
      canonicalParamId: 'attachments',
      placeholder: 'Upload files to attach',
      mode: 'basic',
      multiple: true,
      required: false,
    },
    // Variable reference (advanced mode)
    {
      id: 'attachments',
      title: 'Attachments',
      type: 'short-input',
      canonicalParamId: 'attachments',
      placeholder: 'Reference files from previous blocks',
      mode: 'advanced',
      required: false,
    },

    // Advanced Options Section
    {
      id: 'fromName',
      title: 'From Name',
      type: 'short-input',
      placeholder: 'Display name for sender',
      mode: 'advanced',
      required: false,
    },
    {
      id: 'cc',
      title: 'CC',
      type: 'short-input',
      placeholder: 'cc1@example.com, cc2@example.com',
      mode: 'advanced',
      required: false,
    },
    {
      id: 'bcc',
      title: 'BCC',
      type: 'short-input',
      placeholder: 'bcc1@example.com, bcc2@example.com',
      mode: 'advanced',
      required: false,
    },
    {
      id: 'replyTo',
      title: 'Reply To',
      type: 'short-input',
      placeholder: 'reply@example.com',
      mode: 'advanced',
      required: false,
    },
  ],

  tools: {
    access: ['smtp_send_mail'],
    config: {
      tool: () => 'smtp_send_mail',
      params: (params) => ({
        smtpHost: params.smtpHost,
        smtpPort: Number(params.smtpPort),
        smtpUsername: params.smtpUsername,
        smtpPassword: params.smtpPassword,
        smtpSecure: params.smtpSecure,
        from: params.from,
        to: params.to,
        subject: params.subject,
        body: params.body,
        contentType: params.contentType,
        fromName: params.fromName,
        cc: params.cc,
        bcc: params.bcc,
        replyTo: params.replyTo,
        attachments: normalizeFileInput(params.attachments),
      }),
    },
  },

  inputs: {
    smtpHost: { type: 'string', description: 'SMTP server hostname' },
    smtpPort: { type: 'number', description: 'SMTP server port' },
    smtpUsername: { type: 'string', description: 'SMTP authentication username' },
    smtpPassword: { type: 'string', description: 'SMTP authentication password' },
    smtpSecure: { type: 'string', description: 'Security protocol (TLS, SSL, or None)' },
    from: { type: 'string', description: 'Sender email address' },
    to: { type: 'string', description: 'Recipient email address' },
    subject: { type: 'string', description: 'Email subject' },
    body: { type: 'string', description: 'Email body content' },
    contentType: { type: 'string', description: 'Content type (text or html)' },
    fromName: { type: 'string', description: 'Display name for sender' },
    cc: { type: 'string', description: 'CC recipients (comma-separated)' },
    bcc: { type: 'string', description: 'BCC recipients (comma-separated)' },
    replyTo: { type: 'string', description: 'Reply-to email address' },
    attachments: { type: 'array', description: 'Files to attach (UserFile array)' },
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the email was sent successfully' },
    messageId: { type: 'string', description: 'Message ID from SMTP server' },
    to: { type: 'string', description: 'Recipient email address' },
    subject: { type: 'string', description: 'Email subject' },
    error: { type: 'string', description: 'Error message if sending failed' },
  },
}

export const SmtpBlockMeta = {
  tags: ['messaging', 'automation'],
  templates: [
    {
      icon: SmtpIcon,
      title: 'Scheduled daily digest email',
      prompt:
        'Build a scheduled workflow that gathers the day’s key updates, has an agent write a clean HTML summary, and sends it as a daily digest email to the team over SMTP.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['email', 'reporting', 'automation'],
    },
    {
      icon: SmtpIcon,
      title: 'Alert email when a condition is met',
      prompt:
        'Create a workflow that checks a metric or status, and when it crosses a threshold, sends an alert email over SMTP with the details and a clear subject so the on-call person notices immediately.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['email', 'alerting', 'automation'],
    },
    {
      icon: SmtpIcon,
      title: 'Email a generated report as an attachment',
      prompt:
        'Build a workflow that generates a report file, then sends it as an email attachment over SMTP to the requested recipients with a short summary in the body.',
      modules: ['files', 'agent', 'workflows'],
      category: 'operations',
      tags: ['email', 'attachments', 'reporting'],
    },
    {
      icon: SmtpIcon,
      title: 'Personalized outreach from a recipient table',
      prompt:
        'Create a workflow that reads a table of recipients, has an agent draft a personalized message for each row, and sends an individual email to every contact over SMTP with their name and details filled in.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['email', 'outreach', 'personalization'],
    },
    {
      icon: SmtpIcon,
      title: 'Form-submission auto-reply',
      prompt:
        'Build a workflow that triggers on a new form submission and sends an automatic confirmation email over SMTP to the submitter, using their address as the recipient and a friendly reply-to.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['email', 'auto-reply', 'automation'],
    },
    {
      icon: SmtpIcon,
      title: 'Incident notification email',
      prompt:
        'Create a workflow that, when an incident is detected, sends a notification email over SMTP to a distribution list with the severity, impact, and next steps, cc’ing the stakeholders who need to be looped in.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['email', 'incident', 'notification'],
    },
    {
      icon: SmtpIcon,
      title: 'Weekly summary email',
      prompt:
        'Build a scheduled workflow that compiles the week’s results into an HTML summary with an agent and emails it over SMTP to the team every Friday, with a link-friendly reply-to for follow-ups.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['email', 'summary', 'reporting'],
    },
  ],
  skills: [
    {
      name: 'send-html-email',
      description:
        'Send a formatted HTML email over SMTP with subject, recipients, and a reply-to.',
      content:
        '# Send HTML Email\n\nSend a well-formatted email through any SMTP server.\n\n## Steps\n1. Set the from, to, and subject fields, adding cc or bcc recipients when needed.\n2. Compose the body as HTML and set the content type to html.\n3. Set a reply-to address so responses route to the right inbox.\n4. Send the email and capture the returned message id.\n\n## Output\nReport whether the email was sent, the recipient, the subject, and the message id.',
    },
    {
      name: 'email-with-attachment',
      description: 'Attach a generated file to an email and send it over SMTP.',
      content:
        '# Email With Attachment\n\nSend a report or document as an email attachment.\n\n## Steps\n1. Generate or reference the file from a previous block.\n2. Pass the file into the attachments field of the SMTP send.\n3. Write a short body summarizing what the attachment contains.\n4. Send to the recipients and record the message id.\n\n## Output\nConfirm the email was sent with the attachment, and return the recipient and message id.',
    },
    {
      name: 'personalized-batch-email',
      description: 'Send an individual, personalized email to each recipient in a table.',
      content:
        '# Personalized Batch Email\n\nSend one tailored email per recipient from a table of contacts.\n\n## Steps\n1. Read the recipient rows, each with an email address and personalization fields.\n2. For each row, draft a personalized subject and body.\n3. Send an individual email over SMTP so recipients do not see one another.\n4. Track successes and failures per recipient.\n\n## Output\nReturn the count of emails sent, and list any recipients that failed with the error.',
    },
    {
      name: 'scheduled-digest-email',
      description: 'Compile updates on a schedule and send them as a recurring digest email.',
      content:
        '# Scheduled Digest Email\n\nSend a recurring summary email on a fixed cadence.\n\n## Steps\n1. On the schedule, gather the relevant updates for the period.\n2. Have an agent build a concise HTML summary.\n3. Set the subject with the date or period and send over SMTP to the distribution list.\n4. Use bcc for large lists to protect recipient privacy.\n\n## Output\nConfirm the digest was sent, the number of recipients, and the message id.',
    },
  ],
} as const satisfies BlockMeta
